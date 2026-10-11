# Shared inbox and agents

Clients write on LINE, Messenger and WhatsApp. All of it lands in one inbox, a self-hosted [Chatwoot](https://www.chatwoot.com) at https://chatwoot-production-22d6.up.railway.app (Railway project `ezvisa-chat`, Singapore). EzVisa shows that inbox on its own **Inbox** page, next to each client's cases, so the team can work without leaving the dashboard.

**Agents** answer first. You create them on the **Agents** page:
- Each has a name, instructions, a model and the inboxes it answers.
- Each has a role, which decides which of EzVisa's MCP tools it may use, exactly as for an MCP token.
- A client agent explains services, checks who the client is (or registers someone new), opens the case their need calls for, or shares the open one, and sends its checklist. It works on that one client's records only.
- A team agent answers people on the team in a staff chat, with no more than their own permissions.
- Every agent hands over to the team when it should.

## Setting it up

Do these in order. Steps 1 to 3 take a few minutes; the channels in step 4 depend on Meta and LINE.

### 1. Create the Chatwoot administrator

Open https://chatwoot-production-22d6.up.railway.app and create the account with Namtarn's business email. The first person to open that page becomes the super administrator, so do it straight away.

Sign-ups are closed after that. Add the team in Chatwoot under Settings, Agents. Chatwoot sends invitations by email, which needs an email provider (SMTP variables on the `Chatwoot` service in Railway). Until one is set, create agents with a password from the super admin console at `/super_admin`.

### 2. Connect EzVisa to Chatwoot

1. In Chatwoot, open your avatar, Profile settings, and copy the **Access Token** at the bottom. It must be an administrator's token.
2. In Railway, project **considerate-vitality**, service **ezvisa**, Variables: add `CHATWOOT_API_TOKEN` with that token. The service redeploys.

`CHATWOOT_URL` is already set. EzVisa's Settings page then shows the **Shared inbox** card as connected, and the **Inbox** page lists the conversations.

### 3. Give the agents a model

1. In the [Anthropic Console](https://console.anthropic.com), under the organization of Namtarn's company, add billing and create an API key. A workspace of its own (say "EzVisa agents") gives it a spend limit and its own cost report.
2. In Railway, project **considerate-vitality**, service **ezvisa**, add `ANTHROPIC_API_KEY` with that key. Not the `ezvisa-chat` project: Chatwoot never calls Claude.

Each agent picks its model on the Agents page: Sonnet 5.5 by default, Haiku 4.5 to spend less, Opus 5.5 for the hardest work. Without a key, agents hand every new conversation to the team, with a note saying why.

### 4. Connect the channels

In Chatwoot, go to Settings, Inboxes, **Add Inbox**.

**LINE.** In the LINE Official Account Manager, turn on the Messaging API (Settings, Messaging API) and note the channel. In the [LINE Developers console](https://developers.line.biz/console/), open that channel and copy the Channel ID, the Channel secret and a long-lived Channel access token. Paste them into Chatwoot's LINE inbox. Chatwoot then shows a webhook URL: paste it in the LINE Developers console (Messaging API, Webhook URL), press Verify, and turn on **Use webhook**. In the Official Account Manager, under Response settings, turn off auto-response messages, or clients get two answers.

LINE counts every message the agency sends from Chatwoot, the agents' included, against the plan's monthly allowance. In Thailand the free plan allows 300 messages a month; Basic (1,280 THB, 15,000 messages) or Pro (1,780 THB, 35,000) suits a busy account ([prices](https://website.z.com/th/en/lineoa-article-package/), before VAT).

**Messenger (the EZVISA Facebook page).** Chatwoot needs a Meta app of its own:

1. In [Meta for Developers](https://developers.facebook.com), create a Business app owned by Namtarn's business portfolio, and add **Facebook Login** and **Messenger**.
2. On the `Chatwoot` service in the **ezvisa-chat** project, set `FB_APP_ID`, `FB_APP_SECRET` (from the app's settings) and `FB_VERIFY_TOKEN` (any long random string you choose).
3. In the app's Messenger settings, set the callback URL to `https://chatwoot-production-22d6.up.railway.app/bot` with that verify token. Subscribe the page to `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads` and `message_echoes`.
4. Request advanced access to `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement` and `business_management`. Meta reviews this before real messages flow, which can take days.
5. In Chatwoot, add a Messenger inbox, sign in with Facebook and pick the page.

Details: [Chatwoot's Facebook guide](https://developers.chatwoot.com/self-hosted/configuration/features/integrations/facebook-channel-setup).

**WhatsApp.** Use the WhatsApp Business Platform (Cloud API), with a number that is not registered in the WhatsApp app.

1. In Meta for Developers, add **WhatsApp** to the same app and register the number.
2. Create a permanent token: Business settings, System users, add one with `whatsapp_business_messaging` and `whatsapp_business_management`.
3. In Chatwoot, add a WhatsApp inbox with provider WhatsApp Cloud. Enter the number, the Phone number ID, the WhatsApp Business Account ID and the token.
4. Chatwoot then shows a callback URL and a verify token. Enter them in the app (WhatsApp, Configuration, Webhook) and subscribe to `messages`.

WhatsApp only lets a business write freely within 24 hours of the client's last message. Replies inside that window are fine; writing first, for example a reminder, needs an approved template, which EzVisa does not send yet.

**Website chat (optional).** A Website inbox gives a chat bubble snippet for any site.

### 5. Create the agents

On the **Agents** page (owners):

1. **New agent.** For the LINE channel, for example:
   - name "LINE front desk";
   - talks to **Clients**;
   - role **Client agent**, which can register new clients, open their cases from a template, read their cases and documents, and share the checklist;
   - instructions such as "Greet warmly, find out what the client needs, send their upload link when documents are missing."
2. **Inboxes.** Tick the LINE inbox. EzVisa creates the agent's bot in Chatwoot and assigns it; new conversations there go to the agent first. An inbox has one agent at a time.
3. For a staff chat, for example a LINE group for the team in its own inbox, create a second agent that talks to **The team**, with a role such as **Assistant (MCP)**. Then, in the Inbox, open each colleague's conversation and link it to them (**Or a team member**). The agent answers only linked people, and never with more permissions than they have themselves.

In Settings, **Shared inbox**:
- **What every agent should know** holds opening hours, address, prices and languages. Without prices there, agents pass price questions to the team.
- **Agents answer** pauses every agent at once.

### 6. Phones

The Chatwoot apps for iOS and Android connect to the same address. In EzVisa, turn notifications on (Settings, Notifications) to hear when an agent hands a conversation over.

## How it works

**The Inbox in EzVisa.** Conversations from every channel, newest first:
- **With the team** (open), **With agents** (pending), **Resolved** and **All**, and a filter per inbox.
- Opening one shows the messages, photos and files sent in the chat, private notes, and who is writing. For a client, that means their open cases and what each still needs, with links to the case pages.
- **Reply** sends to the client and takes the conversation from the agent. **Private note** stays with the team.
- **Take over**, **Hand to agent** and **Resolve** move it between the agent and the team.
- **Open in Chatwoot** is there for anything else, such as attachments to send.
- The Inbox badge in the navigation counts conversations waiting for the team.

**A new message** starts as *pending*, which means it belongs to the inbox's agent. The agent waits a few seconds for follow-up messages, then answers them together, in the person's language.

**Client agents and identity.**
- Before touching a client's records, a client agent asks for the full name as in the passport and the date of birth, and checks them against EzVisa. A match links the chat contact to the client for good.
- On WhatsApp, a number that matches exactly one client is linked without asking.
- After three failed checks in a day it stops trying and hands over.
- The team can also link a conversation from the Inbox, or from the client's page.
- Once a contact is linked, Chatwoot shows an **EzVisa client** link on the contact, so whoever answers in Chatwoot is one click from the case.

**Checklists from the chat.** A client agent works out which service the person needs from the templates, and asks when it is unsure.
- **An identified client with an open case for that service:** the agent shares that case's checklist (`create_client_upload_link`). A second case for the same service is refused by the server, not only by the instructions.
- **An identified client without one:** the agent says which service it will open and waits for a yes, then opens the case from the template (`create_case`), which creates the checklist, and shares it.
- **Someone new:** after the identity check fails or they say they are new, the agent asks for the full name as in the passport, nationality and date of birth, and confirms the service. It then registers them (`create_client`), which links the conversation to the new client, and opens and shares the case the same way.
  - No passport number is taken in the chat, and consent is never recorded for them: the client accepts the privacy notice on the upload page.
  - Someone already registered under the same name and date of birth cannot be registered twice: the agent is told to check their identity instead.
- Through the chat, a client can change only how to reach them (email, phone, channel, address), never their name, date of birth or passport details.
- Each time an agent registers a client, opens a case or shares a checklist, it leaves a private note in the conversation for the team, and the activity feed shows it under the agent's name. Cases opened by an agent have no assignee: assign them from the case page.
- Team agents can do the same for any client their colleague may handle, and post the link in that client's own conversation (`send_chat_message`) once the colleague agrees.

**What agents can do.** An agent uses EzVisa's MCP tools, the same ones Claude uses over MCP, filtered by its role.
- A **client agent** is limited to the identified client: a tool on someone else's case or document is refused, lists are filtered to that client, and tools that cannot be limited are not offered (listing every client, reminders, the team, template editing, the inbox).
- A **team agent** has the tools of its role, cut down to the permissions of the colleague writing to it. A runner asking the agent to change a checklist is refused just as the runner would be.
- No agent can mark an item verified or approve a pack: those stay with people.

**Handing over.** An agent hands a conversation to the team when:
- the person asks for someone, a price that is not in the notes, or a refund;
- the question needs judgement (eligibility, overstay, refusal, lost passport) or is urgent;
- a new prospect wants to start;
- it is unsure.

It tells the person someone will reply. It leaves a private note in Chatwoot with the reason and a summary, sets the conversation to *open*, and notifies the team's devices. The notification opens the conversation in EzVisa's Inbox.

**When someone on the team replies**, from EzVisa or from Chatwoot, the agent steps back and the conversation becomes *open*. To give it back, use **Hand to agent** (or set it to *pending* in Chatwoot). The agent posts a private note saying it is answering again.

**Over MCP**, the team's Claude can work the inbox too:
- `list_conversations`, `get_conversation` and `send_chat_message`, with optional private notes;
- `link_chat_contact` and `link_team_member`;
- `hand_conversation`.

## Privacy

- Conversations and the files clients send in chat stay in Chatwoot, on Namtarn's Railway account in Singapore.
- To write a reply, an agent sends the conversation's latest messages (about 20, without attachments), the notes and the results of the tools it used to Anthropic's API. A client agent's tools only return the identified client's own records. If its role allows reading documents, a document it opens is sent as well. Anthropic does not train models on API data by default. Mention in the privacy notice that an automated assistant answers chats, and accept Anthropic's data processing addendum for the company account.
- Client agents ask clients not to send documents in the chat and send their upload link instead.
- Every action an agent takes is audited under its name, as for any team member.

## Costs

- **Railway:** Chatwoot uses about 1 GB of memory plus its database and queue, roughly 10 to 25 USD a month.
- **Anthropic:** most of each request (instructions and tools) is cached. A reply typically costs around a US cent with Sonnet at list prices; see [current prices](https://www.anthropic.com/pricing). The Shared inbox card in Settings shows this month's replies, handovers and tokens.
- **LINE:** messages count against the Official Account plan (see above). **WhatsApp:** replies within 24 hours of the client's message are free under Meta's current pricing.
