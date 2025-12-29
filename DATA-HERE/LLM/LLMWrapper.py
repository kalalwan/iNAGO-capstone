from abc import ABC, abstractmethod

class LLMResponse:
    def __init__(self, text, raw=None, meta=None):
        self.text = text
        self.raw = raw
        self.meta = meta or {}


class BaseLLM(ABC):
    def __init__(self, model_name=None, **config):
        self.model_name = model_name
        self.config = config

    @abstractmethod
    def generate(self, prompt, **kwargs):
        pass

    def __call__(self, prompt, **kwargs):
        return self.generate(prompt, **kwargs)