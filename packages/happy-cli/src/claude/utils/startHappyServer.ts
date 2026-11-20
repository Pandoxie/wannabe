/**
 * Happy MCP server
 * Tools of the current session: change_title, and (Original Happy) the fleet
 * tools list_agents / send_to_agent, which reach the account's other agents
 * through the fleet hub (src/fleet/fleetClient.ts).
 *
 * Uses stateless StreamableHTTP: each request gets a fresh McpServer + transport.
 * This is required by MCP SDK >=1.27 which rejects reuse of an already-connected transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { keptTitleMessage } from "@/original/sessionTitle";
import { HAPPY_TOOLS, type HappyToolResult } from "./happyTools";
import { fleetRequest, formatAgents, formatTask, type FleetTask } from "@/fleet/fleetClient";

type Handlers = {
    changeTitle: (title: string, userChosen: boolean) => Promise<HappyToolResult>;
    listAgents: () => Promise<HappyToolResult>;
    sendToAgent: (to: string, text: string) => Promise<HappyToolResult>;
    notifyOwner: (text: string) => Promise<HappyToolResult>;
    scheduleTask: (args: { name: string; prompt: string; cron?: string; at?: string; timezone?: string }) => Promise<HappyToolResult>;
    listTasks: () => Promise<HappyToolResult>;
    deleteTask: (id: string) => Promise<HappyToolResult>;
};

const text = (t: string, isError = false): HappyToolResult => ({ content: [{ type: 'text', text: t }], isError });

function createMcpServer(handlers: Handlers): McpServer {
    const mcp = new McpServer({ name: "Happy MCP", version: "1.0.0" });
    mcp.registerTool('change_title', HAPPY_TOOLS.change_title, async (args: any) => handlers.changeTitle(args.title, args.userChosen === true));
    mcp.registerTool('list_agents', HAPPY_TOOLS.list_agents, async () => handlers.listAgents());
    mcp.registerTool('send_to_agent', HAPPY_TOOLS.send_to_agent, async (args: any) => handlers.sendToAgent(args.to, args.text));
    mcp.registerTool('notify_owner', HAPPY_TOOLS.notify_owner, async (args: any) => handlers.notifyOwner(args.text));
    mcp.registerTool('schedule_task', HAPPY_TOOLS.schedule_task, async (args: any) => handlers.scheduleTask(args));
    mcp.registerTool('list_tasks', HAPPY_TOOLS.list_tasks, async () => handlers.listTasks());
    mcp.registerTool('delete_task', HAPPY_TOOLS.delete_task, async (args: any) => handlers.deleteTask(args.id));
    return mcp;
}

export async function startHappyServer(client: ApiSessionClient) {
    logger.debug(`[happyMCP] server:start sessionId=${client.sessionId}`);

    const handlers: Handlers = {
        async changeTitle(title, userChosen) {
            logger.debug('[happyMCP] Changing title to:', title, userChosen ? '(user chosen)' : '');
            try {
                const r = client.setTitle(title, userChosen);
                if (!r.ok) return text(keptTitleMessage(r.current));
                return text(`Successfully changed chat title to: "${title}"`);
            } catch (error) {
                return text(`Failed to change chat title: ${String(error)}`, true);
            }
        },
        async listAgents() {
            const a = await fleetRequest(client, { op: 'list' });
            return a.ok ? text(formatAgents(a as any)) : text(a.error, true);
        },
        async sendToAgent(to, body) {
            const a = await fleetRequest(client, { op: 'send', to, text: body });
            if (!a.ok) return text(a.error, true);
            const name = a.delivered?.name ?? a.delivered?.session ?? to;
            // A grey line in this session's chat, so the user sees who was told what.
            client.sendSessionEvent({ type: 'message', message: `→ ${name}: ${body.length > 160 ? body.slice(0, 157) + '…' : body}` });
            return text(`${a.note ?? 'Delivered.'} (to "${name}", session ${a.delivered?.session ?? '?'})`);
        },
        async notifyOwner(body) {
            const r = client.notifyOwner(body);
            return r.ok ? text('Notification sent.') : text(r.error, true);
        },
        async scheduleTask(args) {
            const a = await fleetRequest(client, { op: 'task.create', name: args.name, prompt: args.prompt, cron: args.cron, at: args.at, timezone: args.timezone });
            if (!a.ok) return text(a.error, true);
            const t = a.task as FleetTask;
            client.sendSessionEvent({ type: 'message', message: `⏰ 定时任务「${t.name}」：${t.schedule}，下次 ${t.next ?? '—'}` });
            return text(`Scheduled.\n${formatTask(t)}`);
        },
        async listTasks() {
            const a = await fleetRequest(client, { op: 'task.list' });
            if (!a.ok) return text(a.error, true);
            const tasks = a.tasks as FleetTask[];
            return text(tasks.length ? `Scheduled tasks of this session:\n${tasks.map(formatTask).join('\n')}` : 'This session has no scheduled tasks.');
        },
        async deleteTask(id) {
            const a = await fleetRequest(client, { op: 'task.delete', id });
            if (!a.ok) return text(a.error, true);
            client.sendSessionEvent({ type: 'message', message: `⏰ 已删除定时任务「${a.deleted?.name ?? id}」` });
            return text(`Deleted task ${a.deleted?.id ?? id} "${a.deleted?.name ?? ''}".`);
        },
    };

    const server = createServer(async (req, res) => {
        const mcp = createMcpServer(handlers);
        try {
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
            res.on('close', () => {
                transport.close();
                mcp.close();
            });
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
            mcp.close();
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug(`[happyMCP] server:ready sessionId=${client.sessionId} url=${baseUrl.toString()}`);

    return {
        url: baseUrl.toString(),
        toolNames: Object.keys(HAPPY_TOOLS),
        stop: () => {
            logger.debug(`[happyMCP] server:stop sessionId=${client.sessionId}`);
            server.close();
        }
    }
}
