import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
export class BaseTool {
    validateDatabase(database) {
        if (typeof database !== "string") {
            throw new McpError(ErrorCode.InvalidRequest, `Database name must be a string, got ${typeof database}`);
        }
        return database;
    }
    validateCollection(collection) {
        if (typeof collection !== "string") {
            throw new McpError(ErrorCode.InvalidRequest, `Collection name must be a string, got ${typeof collection}`);
        }
        return collection;
    }
    validateObject(value, name) {
        if (!value || typeof value !== "object") {
            throw new McpError(ErrorCode.InvalidRequest, `${name} must be an object`);
        }
        return value;
    }
    handleError(error) {
        return {
            content: [
                {
                    type: "text",
                    text: error instanceof Error ? error.message : String(error),
                },
            ],
            isError: true,
        };
    }
}
