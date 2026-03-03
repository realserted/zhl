import { NextRequest, NextResponse } from 'next/server';

interface TxInput {
  id: string;
  description: string;
}

interface CatInput {
  id: string;
  name: string;
}

interface CategorizeResult {
  txId: string;
  categoryId: string | null;
  confidence?: 'high' | 'low';
}

const BATCH_SIZE = 50;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as {
    transactions?: TxInput[];
    categories?: CatInput[];
    customPrompt?: string;
  } | null;

  if (!body?.transactions?.length || !body?.categories?.length) {
    return NextResponse.json({ results: [] });
  }

  const { transactions, categories, customPrompt } = body;

  const categoryList = categories.map((c) => `- ${c.id}: ${c.name}`).join('\n');

  const allResults: CategorizeResult[] = [];

  // Process in batches
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);

    const txList = batch.map((t) => `- ${t.id}: ${t.description}`).join('\n');

    const customInstructions = customPrompt
      ? `\nAdditional instructions from bank type configuration:\n${customPrompt}\n`
      : '';

    const prompt = `You are a financial transaction categorizer. Given these categories:
${categoryList}
${customInstructions}
Categorize each transaction by its description. You MUST always pick the single best matching category_id — never leave it null. Even if the match is uncertain, pick the closest one.

Also indicate your confidence: "high" if you are confident in the match, "low" if it is a guess or uncertain.

Return ONLY a JSON array with this exact format, no other text:
[{"txId": "...", "categoryId": "...", "confidence": "high" or "low"}]

Transactions:
${txList}`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        },
      );

      if (!res.ok) {
        console.error('Gemini API error:', res.status, await res.text());
        continue;
      }

      const data = await res.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      // Parse JSON from response
      const parsed = JSON.parse(text) as CategorizeResult[];
      if (Array.isArray(parsed)) {
        // Validate category IDs exist
        const validCatIds = new Set(categories.map((c) => c.id));
        for (const r of parsed) {
          const validCatId = r.categoryId && validCatIds.has(r.categoryId) ? r.categoryId : null;
          allResults.push({
            txId: r.txId,
            categoryId: validCatId,
            confidence: validCatId ? (r.confidence === 'low' ? 'low' : 'high') : undefined,
          });
        }
      }
    } catch (err) {
      console.error('Gemini categorize batch error:', err);
      // Continue with remaining batches
    }
  }

  return NextResponse.json({ results: allResults });
}
