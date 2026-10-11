import { chat } from "@ezvisa/core";
import { canAdminister, canEdit, canView, defineTool } from "../tool.js";

export const chatTools = [
  defineTool({
    name: "list_conversations",
    title: "List conversations in the shared inbox",
    description:
      "Conversations with clients on LINE, Messenger, WhatsApp and other channels (Chatwoot), newest activity first, each with the EzVisa client it is linked to. status: open (with the team, the default), pending (with an agent), resolved, or all; inboxId narrows to one channel. 25 per page.",
    input: chat.listConversationsInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("clients"),
    run: (ctx, input) => chat.listConversations(ctx, input),
  }),
  defineTool({
    name: "get_conversation",
    title: "Read a conversation",
    description:
      "The latest messages of a conversation (about 20) with attachments, who wrote each (contact, agent or team, and whether it was a private note), and who is writing: the linked client with their open cases, or the team member.",
    input: chat.getConversationInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("clients"),
    run: (ctx, input) => chat.getConversation(ctx, input),
  }),
  defineTool({
    name: "send_chat_message",
    title: "Write to a client in the shared inbox",
    description:
      "Writes in a conversation, or in a client's most recent one, as the team: the conversation then leaves the agent (open). private: true leaves a note only the team sees. Plain text, short, in the client's language. To share an upload link, create it with create_client_upload_link and paste its url. On WhatsApp, a message only reaches the client within 24 hours of their last message.",
    input: chat.sendChatMessageInput,
    visibleTo: canEdit("clients"),
    run: (ctx, input) => chat.sendChatMessage(ctx, input),
  }),
  defineTool({
    name: "link_chat_contact",
    title: "Link a conversation to a client",
    description:
      "Records that the person writing in a conversation is this client, once you have confirmed it (full name and date of birth). Client agents can then work on that client's records with them, and Chatwoot shows a link to the client's EzVisa page.",
    input: chat.linkChatContactInput,
    visibleTo: canEdit("clients"),
    run: (ctx, input) => chat.linkChatContact(ctx, input),
  }),
  defineTool({
    name: "hand_conversation",
    title: "Hand a conversation to the agent or the team",
    description:
      "to: team takes the conversation from the inbox's agent (it stops answering); to: agent lets it answer again; to: resolved closes it.",
    input: chat.handConversationInput,
    annotations: { idempotentHint: true },
    visibleTo: canEdit("clients"),
    run: (ctx, input) => chat.handConversation(ctx, input),
  }),
  defineTool({
    name: "link_team_member",
    title: "Say who on the team is writing",
    description:
      "Records that the person writing in a conversation is this employee, so team agents answer them with no more than that employee's permissions. Owners only.",
    input: chat.linkTeamMemberInput,
    visibleTo: canAdminister("team"),
    run: (ctx, input) => chat.linkTeamMember(ctx, input),
  }),
];
