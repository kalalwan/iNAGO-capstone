import json
import re
from prompts.preference_extraction_v1 import SYSTEM_PROMPT, USER_PROMPT
from sessions.conversation_parser import parse_and_combine_by_user
from config.aspects import ASPECTS

def extract_preferences(llm, utterance):
    full_prompt = (
        SYSTEM_PROMPT.strip()
        + "\n\n"
        + USER_PROMPT.format(
            aspects=", ".join(ASPECTS),
            utterance=utterance
        )
    )

    response = llm.generate(full_prompt)
    text = response.text

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("No JSON found in LLM output")

    data = json.loads(match.group())

    return {
        "hard_preferences": data.get("hard_preferences", []),
        "soft_preferences": data.get("soft_preferences", [])
    }


def extract_preferences_from_conversation(llm, conversation):
    combined = parse_and_combine_by_user(conversation)

    results = {}

    for user_id, utterances in combined.items():
        text_block = "\n".join(
            f"- {u}" for u in utterances
        )

        prefs = extract_preferences(llm, text_block)

        results[user_id] = {
            "utterances": utterances,
            "preferences": prefs
        }

    return results

