import json
import re
from prompts.memory_action_v1 import SYSTEM_PROMPT, USER_PROMPT


def suggest_memory_actions(llm, existing_memory, extracted_preferences):
    full_prompt = (
        SYSTEM_PROMPT.strip()
        + "\n\n"
        + USER_PROMPT.format(
            existing_memory=json.dumps(existing_memory, indent=2),
            new_preferences=json.dumps(extracted_preferences, indent=2)
        )
    )

    response = llm.generate(full_prompt)
    text = response.text

    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        raise ValueError("No JSON array found in LLM output")

    return json.loads(match.group())
