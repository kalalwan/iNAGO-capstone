from openai import OpenAI
from .LLMWrapper import BaseLLM, LLMResponse


class OpenAILLM(BaseLLM):
    def __init__(self, api_key, model_name="gpt-3.5-turbo", **config):
        super().__init__(model_name=model_name, **config)
        self.client = OpenAI(api_key=api_key)

    def generate(self, prompt, **kwargs):
        res = self.client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            **self.config,
            **kwargs,
        )

        return LLMResponse(
            text=res.choices[0].message.content,
            raw=res,
            meta={
                "model": self.model_name,
                "usage": res.usage.model_dump() if res.usage else None,
            },
        )
