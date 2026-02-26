// backend/aiVerifier.js
// This is the brain of the app - it uses Claude AI to verify habit completion

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Verifies whether a habit was completed based on proof provided
 * @param {string} habitName - Name of the habit (e.g. "Morning Run")
 * @param {string} habitDescription - What the habit involves
 * @param {string} proofInstructions - What proof the user should provide
 * @param {string|null} imagePath - Path to uploaded image (if any)
 * @param {string|null} proofNote - Text note from user (if any)
 * @returns {object} { verified: bool, explanation: string, xpEarned: number }
 */
async function verifyHabit(habitName, habitDescription, proofInstructions, imagePath, proofNote) {
  
  // Build the message content
  const content = [];

  // If user uploaded an image, include it
  if (imagePath) {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    
    // Detect image type from file extension
    const ext = imagePath.split('.').pop().toLowerCase();
    const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    const mediaType = mimeTypes[ext] || 'image/jpeg';

    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64Image }
    });
  }

  // Build the text prompt
  const prompt = `You are an AI habit verification assistant. A user is trying to prove they completed a habit.

HABIT: ${habitName}
DESCRIPTION: ${habitDescription || 'No description provided'}
WHAT COUNTS AS PROOF: ${proofInstructions}

${proofNote ? `USER'S NOTE: ${proofNote}` : ''}
${imagePath ? 'The user has uploaded an image as proof (shown above).' : 'No image was uploaded.'}

Your job:
1. Examine the evidence carefully
2. Decide if the habit was genuinely completed
3. Be encouraging but honest - don't approve if there's no real evidence
4. Give a brief, friendly explanation

Respond with ONLY this JSON format (no other text):
{
  "verified": true or false,
  "explanation": "Your brief, friendly explanation here (1-2 sentences)",
  "confidence": "high", "medium", or "low"
}`;

  content.push({ type: 'text', text: prompt });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content }]
    });

    // Parse the JSON response
    const responseText = response.content[0].text.trim();
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    const result = JSON.parse(cleaned);

    // Calculate XP earned
    let xpEarned = 0;
    if (result.verified) {
      xpEarned = result.confidence === 'high' ? 50 : result.confidence === 'medium' ? 35 : 20;
    }

    return {
      verified: result.verified,
      explanation: result.explanation,
      xpEarned
    };

  } catch (error) {
    console.error('AI verification error:', error);
    return {
      verified: false,
      explanation: 'Could not verify at this time. Please try again.',
      xpEarned: 0
    };
  }
}

module.exports = { verifyHabit };
