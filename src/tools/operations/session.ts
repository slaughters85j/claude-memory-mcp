/**
 * Session Tools
 *
 * get_session_context: Quick status check at conversation start.
 * Surfaces unfinished work and recent activity without Claude having to ask multiple questions.
 */

import { BaseTool, ToolParams, ToolResponse } from "../base/tool.js";
import {
  getOverdueTodos,
  getHighPriorityTodos,
  getTodoCountsByPriority,
  getRecentlyUpdatedTopics,
  getStaleTopics,
  getMemoryCountSince,
  Todo,
  TopicSummary,
} from "../../schema/memorySchema.js";

interface GetSessionContextParams extends ToolParams {
  include_overdue?: boolean;
  include_high_priority?: boolean;
  recent_days?: number;
  active_topics_only?: boolean;
}

interface SessionContextResponse {
  todo_summary: {
    total_open: number;
    by_priority: {
      urgent: number;
      high: number;
      medium: number;
      low: number;
    };
    overdue?: Todo[];
    high_priority?: Todo[];
  };
  recent_activity: {
    topics_updated: TopicSummary[];
    memories_added: number;
    memories_updated: number;
  };
  stale_topics: TopicSummary[];
}

export class GetSessionContextTool extends BaseTool<GetSessionContextParams> {
  name = "get_session_context";
  description =
    "Get a summary of open items and recent activity. Call this at the start of conversations to check for unfinished work, overdue items, and recent context. Returns compact counts and lists - does not include full memory content.";

  inputSchema = {
    type: "object" as const,
    properties: {
      include_overdue: {
        type: "boolean",
        description: "Include list of overdue todos",
        default: true,
      },
      include_high_priority: {
        type: "boolean",
        description: "Include list of high priority todos",
        default: true,
      },
      recent_days: {
        type: "number",
        description: "Include memories updated in last N days",
        default: 7,
      },
      active_topics_only: {
        type: "boolean",
        description: "Only include active topics in recent activity",
        default: true,
      },
    },
  };

  async execute(params: GetSessionContextParams): Promise<ToolResponse> {
    try {
      const includeOverdue = params.include_overdue ?? true;
      const includeHighPriority = params.include_high_priority ?? true;
      const recentDays = params.recent_days ?? 7;
      const activeTopicsOnly = params.active_topics_only ?? true;

      // Get todo counts by priority
      const priorityCounts = await getTodoCountsByPriority();
      const totalOpen =
        priorityCounts.urgent +
        priorityCounts.high +
        priorityCounts.medium +
        priorityCounts.low;

      // Build todo summary
      const todoSummary: SessionContextResponse["todo_summary"] = {
        total_open: totalOpen,
        by_priority: priorityCounts,
      };

      if (includeOverdue) {
        todoSummary.overdue = await getOverdueTodos();
      }

      if (includeHighPriority) {
        todoSummary.high_priority = await getHighPriorityTodos();
      }

      // Get recent activity
      let recentTopics = await getRecentlyUpdatedTopics(recentDays);
      if (activeTopicsOnly) {
        recentTopics = recentTopics.filter((t) => t.status === "active");
      }

      const memoryCounts = await getMemoryCountSince(recentDays);

      const recentActivity: SessionContextResponse["recent_activity"] = {
        topics_updated: recentTopics.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          importance: t.importance,
          last_referenced_at: t.last_referenced_at,
        })),
        memories_added: memoryCounts.added,
        memories_updated: memoryCounts.updated,
      };

      // Get stale topics (active but no activity in 30+ days)
      const staleTopics = await getStaleTopics(30);
      const staleTopicSummaries: TopicSummary[] = staleTopics.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        importance: t.importance,
        last_referenced_at: t.last_referenced_at,
      }));

      const response: SessionContextResponse = {
        todo_summary: todoSummary,
        recent_activity: recentActivity,
        stale_topics: staleTopicSummaries,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }
}
