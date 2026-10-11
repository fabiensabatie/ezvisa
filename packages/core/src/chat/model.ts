import Anthropic from "@anthropic-ai/sdk";

export type ChatTool = Anthropic.Tool;
export type ChatTurn = Anthropic.MessageParam;
export type ChatBlock = Anthropic.ContentBlock;

export type ChatRequest = {
  /** Instructions that rarely change, cached between turns. */
  system: string;
  /** Instructions for this conversation: the date, the channel, who the client is. */
  context: string;
  tools: ChatTool[];
  messages: ChatTurn[];
};

export type ChatResponse = {
  content: ChatBlock[];
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/** The language model behind the chat assistant. Tests script one; the server uses Claude. */
export interface ChatModel {
  readonly name: string;
  respond(request: ChatRequest): Promise<ChatResponse>;
}

export const DEFAULT_CHAT_MODEL = "claude-sonnet-5-5";

export class ClaudeChatModel implements ChatModel {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly name: string = DEFAULT_CHAT_MODEL,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async respond(request: ChatRequest): Promise<ChatResponse> {
    const message = await this.client.messages.create({
      model: this.name,
      max_tokens: 1024,
      // The tools and the stable instructions form a cached prefix; the context varies.
      system: [
        { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: request.context },
      ],
      tools: request.tools,
      messages: request.messages,
    });
    return {
      content: message.content,
      stopReason: message.stop_reason,
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/**
 * Claude from ANTHROPIC_API_KEY, in whichever model each agent asks for. Every model is null
 * without a key, and agents then hand conversations to the team.
 */
export function chatModelsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): (name: string) => ChatModel | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const models = new Map<string, ChatModel>();
  return (name) => {
    if (!key) return null;
    let model = models.get(name);
    if (!model) {
      model = new ClaudeChatModel(key, name || DEFAULT_CHAT_MODEL);
      models.set(name, model);
    }
    return model;
  };
}
