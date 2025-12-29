from collections import defaultdict

def parse_and_combine_by_user(conversation):
    combined = defaultdict(list)

    for turn in conversation:
        combined[turn["user_id"]].append(turn["text"])

    return dict(combined)