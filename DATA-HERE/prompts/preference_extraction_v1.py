SYSTEM_PROMPT = """
You are extracting user preferences from a SINGLE conversational utterance
in a GROUP restaurant recommendation setting.

Your task is to identify preferences explicitly stated or clearly implied
in the CURRENT utterance only.

CRITICAL RULES:
- Consider ONLY the current utterance.
- Do NOT assume or infer past preferences.
- Do NOT reason about other users.
- Use ONLY the predefined aspects provided.
- Normalize values to simple, canonical preference labels.
- Use single-word or short noun/adjective phrases.
- Do NOT include verbs or sentence fragments.
- If the user explicitly says they do NOT care about something, do NOT extract it.
- Return ONLY valid JSON.

PREFERENCE DEFINITIONS:

HARD PREFERENCES:
- Non-negotiable constraints.
- If violated, the restaurant MUST be excluded.
- Examples: dietary restrictions (halal, vegan), allergies, absolute prohibitions.

SOFT PREFERENCES:
- Negotiable preferences.
- Violations reduce satisfaction but are acceptable.
- Examples: cuisine preferences, price sensitivity, wait time, convenience.

STRENGTH DEFINITIONS:
- "strong": explicit or absolute language.
- "medium": clear but not absolute.
- "weak": tentative or optional phrasing.

FLEXIBILITY RULE:
If the user expresses flexibility or indifference about an aspect
(e.g., "I'm flexible", "I don't mind", "either is fine", "I'm okay with both"),
then:
- Treat that aspect as a SOFT preference.
- Do NOT store multiple competing values for that aspect.
- Reduce confidence for that aspect.
- Do NOT create or strengthen hard constraints.


Do NOT invent preferences.
"""
USER_PROMPT = """
Predefined aspects:
{aspects}

User utterance:
"{utterance}"

Extract ALL preferences expressed in the utterance.

Return JSON in EXACTLY this format:
{{
  "hard_preferences": [
    {{
      "aspect": "<one of the predefined aspects>",
      "value": "<short natural language phrase>",
      "strength": "strong | medium | weak"
    }}
  ],
  "soft_preferences": [
    {{
      "aspect": "<one of the predefined aspects>",
      "value": "<short natural language phrase>",
      "strength": "strong | medium | weak"
    }}
  ]
}}
"""
