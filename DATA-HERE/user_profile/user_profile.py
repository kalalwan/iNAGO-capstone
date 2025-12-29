from datetime import datetime, timezone
from config.aspects import ASPECTS
from config.confidence import STRENGTH_TO_CONF

class UserProfile:
    def __init__(self, user_id):
        self.user_id = user_id
        self.memory = {}

    def has_memory(self):
        return self.memory != {}
    
    def get_memory_view(self):
        return {
            aspect: list(values.keys())
            for aspect, values in self.memory.items()
            if values
        }
    
    def ingest_extracted_preferences(self, extracted_prefs):
        for group in ["hard_preferences", "soft_preferences"]:
            for pref in extracted_prefs.get(group, []):
                aspect = pref["aspect"]
                value = pref["value"].lower()
                strength = pref["strength"]

                self.memory.setdefault(aspect, {})
                self.memory[aspect][value] = {
                    "confidence": STRENGTH_TO_CONF[strength],
                    "evidence": 1,
                    "last_seen": datetime.now(timezone.utc)
                }

    def apply_actions(self, actions):
        now = datetime.now(timezone.utc)

        for act in actions:
            action = act.get("action")
            aspect = act.get("aspect")
            value = act.get("value")

            if not action or not aspect or not value:
                continue

            if aspect not in ASPECTS:
                continue

            value = value.lower()
            strength = STRENGTH_TO_CONF.get(act.get("strength", "medium"), 0.6)
            self.memory.setdefault(aspect, {})

            if action == "add" and value not in self.memory[aspect]:
                self.memory[aspect][value] = {
                    "confidence": strength,
                    "evidence": 1,
                    "last_seen": now
                }

            elif action == "reinforce" and value in self.memory[aspect]:
                entry = self.memory[aspect][value]
                entry["confidence"] = (
                    entry["confidence"] * entry["evidence"] + strength
                ) / (entry["evidence"] + 1)
                entry["evidence"] += 1
                entry["last_seen"] = now

            elif action == "weaken" and value in self.memory[aspect]:
                self.memory[aspect][value]["confidence"] = max(
                    0.05,
                    self.memory[aspect][value]["confidence"] * 0.6
                )
                self.memory[aspect][value]["last_seen"] = now

            elif action == "merge":
                target = act.get("target")
                if not target:
                    continue

                target = target.lower()

                if target not in self.memory[aspect]:
                    continue

                if value in self.memory[aspect]:
                    self.memory[aspect][target]["confidence"] = max(
                        self.memory[aspect][target]["confidence"],
                        self.memory[aspect][value]["confidence"]
                    )
                    self.memory[aspect][target]["evidence"] += \
                        self.memory[aspect][value]["evidence"]

                    del self.memory[aspect][value]

                self.memory[aspect][target]["last_seen"] = now


    