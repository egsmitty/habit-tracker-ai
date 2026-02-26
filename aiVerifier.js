// backend/aiVerifier.js
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const sharp = require('sharp');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB — safely under the 5MB API limit

/**
 * Compresses an image until it fits under the API size limit.
 * Returns { base64, mediaType }
 */
async function prepareImage(imagePath) {
  // Make sure the file actually exists
  if (!fs.existsSync(imagePath)) {
    throw new Error('Image file not found on disk');
  }

  const ext = imagePath.split('.').pop().toLowerCase();

  // GIFs: check size first, then either pass through or error
  if (ext === 'gif') {
    const data = fs.readFileSync(imagePath);
    if (data.length > MAX_IMAGE_BYTES) {
      throw new Error('GIF is too large. Please use a JPG or PNG instead.');
    }
    return { base64: data.toString('base64'), mediaType: 'image/gif' };
  }

  // For all other images: resize + compress in a loop until small enough
  let quality = 85;
  let imageBuffer = null;

  while (quality >= 20) {
    try {
      imageBuffer = await sharp(imagePath)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    } catch (sharpError) {
      throw new Error(`Could not process image: ${sharpError.message}`);
    }

    if (imageBuffer.length <= MAX_IMAGE_BYTES) break;

    console.log(`📦 Image ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB, retrying at quality ${quality - 15}...`);
    quality -= 15;
  }

  // Safety check — should never happen but just in case
  if (!imageBuffer) {
    throw new Error('Image processing failed unexpectedly');
  }

  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large even after compression. Please use a smaller image.');
  }

  console.log(`✅ Image ready: ${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB at quality ${quality}`);
  return { base64: imageBuffer.toString('base64'), mediaType: 'image/jpeg' };
}

/**
 * Verifies whether a habit was completed based on proof provided.
 * NEVER throws — always returns a valid result object.
 */
async function verifyHabit(habitName, habitDescription, proofInstructions, imagePath, proofNote) {
  const content = [];
  let imageIncluded = false;

  // Try to include the image — if it fails, fall back to note-only
  if (imagePath) {
    try {
      const { base64, mediaType } = await prepareImage(imagePath);
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
      imageIncluded = true;
    } catch (imgError) {
      console.error('Image prep failed, proceeding without image:', imgError.message);
      // Append a note about the failed image so Claude knows what happened
      proofNote = (proofNote || '') + `\n[User uploaded an image but it could not be processed: ${imgError.message}]`;
    }
  }

  const prompt = `You are a habit verification assistant. Be encouraging but honest.

HABIT: ${habitName}
DESCRIPTION: ${habitDescription || 'None provided'}
ACCEPTED PROOF: ${proofInstructions}
${imageIncluded ? 'USER PROVIDED: An image (shown above)' : 'USER PROVIDED: No image'}
${proofNote ? `USER NOTE: ${proofNote}` : ''}

Rules:
- If there is a clear image showing evidence of the habit, verify it (high confidence)
- If the image is vague but plausible, verify it (medium or low confidence)  
- If there's only a note and it sounds reasonable, verify it (low confidence)
- If there's no real evidence at all, do NOT verify
- Keep your explanation friendly and under 2 sentences

Respond with ONLY this JSON (no markdown, no code fences, no extra text):
{"verified":true,"explanation":"Your explanation here.","confidence":"high"}

confidence = "high", "medium", or "low"`;

  content.push({ type: 'text', text: prompt });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content }]
    });

    const rawText = response.content[0]?.text?.trim() || '';

    // Strip any markdown fences Claude might add despite instructions
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Find the JSON object even if there's surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in AI response:', rawText);
      return { verified: false, explanation: 'AI gave an unexpected response. Please try again.', xpEarned: 0 };
    }

    const result = JSON.parse(jsonMatch[0]);

    // Validate the fields we need
    if (typeof result.verified !== 'boolean') {
      console.error('AI response missing verified field:', result);
      return { verified: false, explanation: 'AI gave an incomplete response. Please try again.', xpEarned: 0 };
    }

    const confidence = ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'medium';
    const xpEarned = result.verified
      ? (confidence === 'high' ? 50 : confidence === 'medium' ? 35 : 20)
      : 0;

    return {
      verified: result.verified,
      explanation: result.explanation || (result.verified ? 'Habit verified!' : 'Could not verify this time.'),
      xpEarned
    };

  } catch (error) {
    // Specific error messages for common failure modes
    if (error instanceof SyntaxError) {
      console.error('JSON parse failed:', error.message);
      return { verified: false, explanation: 'AI response could not be parsed. Please try again.', xpEarned: 0 };
    }
    if (error?.status === 401) {
      console.error('Invalid Anthropic API key');
      return { verified: false, explanation: 'Server configuration error (invalid API key). Contact the admin.', xpEarned: 0 };
    }
    if (error?.status === 400) {
      console.error('Bad API request:', error.message);
      return { verified: false, explanation: 'Could not process the image. Try a different format or smaller size.', xpEarned: 0 };
    }
    if (error?.status === 529 || error?.status === 503 || error?.status === 502) {
      console.error('Anthropic API overloaded');
      return { verified: false, explanation: 'AI service is temporarily busy. Please try again in a moment.', xpEarned: 0 };
    }
    if (error?.status === 429) {
      console.error('Rate limit hit');
      return { verified: false, explanation: 'Too many requests right now. Please wait a moment and try again.', xpEarned: 0 };
    }

    console.error('Unexpected verification error:', error);
    return { verified: false, explanation: 'Verification failed unexpectedly. Please try again.', xpEarned: 0 };
  }
}

module.exports = { verifyHabit };
