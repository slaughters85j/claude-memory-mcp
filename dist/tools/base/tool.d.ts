export interface ToolResponse {
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
    _meta?: Record<string, unknown>;
}
export type ToolParams = {
    [key: string]: unknown;
};
export declare abstract class BaseTool<T extends ToolParams = ToolParams> {
    abstract name: string;
    abstract description: string;
    abstract inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
    abstract execute(params: T): Promise<ToolResponse>;
    protected validateDatabase(database: unknown): string;
    protected validateCollection(collection: unknown): string;
    protected validateObject(value: unknown, name: string): Record<string, unknown>;
    protected handleError(error: unknown): ToolResponse;
}
