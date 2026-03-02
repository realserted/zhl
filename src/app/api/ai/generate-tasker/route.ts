import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as {
    type?: 'task_name' | 'status';
    prompt?: string;
    context?: string;
  } | null;

  if (!body?.type || !body?.prompt) {
    return NextResponse.json({ error: 'Missing type or prompt.' }, { status: 400 });
  }

  const { type, prompt, context } = body;

  const systemInstruction =
    type === 'task_name'
      ? 'You are a task name generator. Generate a concise, descriptive task name based on the user\'s prompt and context. Return ONLY the task name text, nothing else.'
      : 'You are a status generator. Generate a brief status update (10 words max) based on the user\'s prompt and context. Return ONLY the status text, nothing else.';

  const userMessage = context
    ? `${prompt}\n\nContext:\n${context}`
    : prompt;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 100 },
        }),
      },
    );

    if (!res.ok) {
      console.error('Gemini API error:', res.status, await res.text());
      return NextResponse.json({ error: 'Gemini API error' }, { status: 502 });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    return NextResponse.json({ result: text });
  } catch (err) {
    console.error('Generate tasker error:', err);
    return NextResponse.json({ error: 'Failed to generate.' }, { status: 500 });
  }
}
