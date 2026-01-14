/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's text-embedding-3-small model via API.
 * Requires OPENAI_API_KEY environment variable.
 *
 * Use as fallback when ONNX is unavailable or when you
 * prefer OpenAI embeddings (set PREFER_OPENAI_EMBEDDINGS=true).
 */
export class OpenAIEmbeddingProvider {
    constructor(apiKey) {
        this.name = "text-embedding-3-small";
        this.dimensions = 1536;
        this.apiKey = apiKey;
    }
    async embed(texts) {
        if (!this.apiKey) {
            throw new Error("OpenAI API key not configured");
        }
        try {
            const response = await fetch("https://api.openai.com/v1/embeddings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.name,
                    input: texts,
                }),
            });
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`OpenAI API error: ${response.status} - ${error}`);
            }
            const data = await response.json();
            // Sort by index to maintain order
            const sorted = data.data.sort((a, b) => a.index - b.index);
            return sorted.map((item) => item.embedding);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("rate limit")) {
                // Simple retry with backoff for rate limits
                console.error("Rate limited, waiting 1 second...");
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return this.embed(texts);
            }
            throw error;
        }
    }
    async embedSingle(text) {
        const results = await this.embed([text]);
        return results[0];
    }
    isAvailable() {
        return !!this.apiKey;
    }
}
