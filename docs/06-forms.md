# Forms EzVisa fills

Every PDF form and letter attached to a template is filled by EzVisa for each case, then checked by a person before anyone uses it. Reference files (sample photos, guides) are not filled.

## How it works

1. **The template's PDF is set up once.** As soon as a PDF form or letter is attached, Claude reads it in the background:
   - A PDF with its own form fields keeps them.
   - A flat PDF or a scan gets fields added where Claude finds the blanks: lines, boxes, cells, ticks. The original file is kept; EzVisa stores a fillable copy next to it. When the PDF has printed text (most government forms do), Claude names the label each blank belongs to, and EzVisa measures the box from that label's exact position: the blank starts after the label and runs to the next label on the line, and a tick box sits just left of its option. A scan has no printed text, so EzVisa finds its dotted and solid writing lines in the image instead, numbers them on a picture of the page, and Claude says which line each blank is written on. Only what has neither, such as a tick box on a scan, relies on Claude's own estimate of its position, which is rougher: check those boxes on **Fields**.
   - Claude then labels every field and says where its value comes from: the client's record (name, passport number, date of birth, address, visa, stay date...), the case, the agency, today's date, the client's documents ("Claude reads it from the documents"), or nobody ("The team fills it": signatures, official use). It also picks how the value is written, for example dates in the Buddhist era (02/04/2503) on Thai forms.
2. **The case's copy is filled when the documents are in.** EzVisa fills the case's forms in the background when the client has sent every required document on their checklist link, and again when the case moves to **Drafting**. **Fill forms** on the case starts it by hand.
   - Values from the records are copied as they are.
   - Claude reads each document of the client once (passport, visa, bank letter, lease...) and keeps what it found on the document. It then fills the remaining fields from those facts only, and leaves a field empty rather than guess.
   - A value a person entered is never overwritten by a later fill.
3. **A person checks it.** On the case, **Forms** shows each form as *Not filled*, *To check* or *Checked*. **Review** opens the filled PDF next to its fields. Each field says who filled it and from what: "From the record: Passport number", "Claude, from Passport", "Entered by Ploy S.", or "For the team". Correct what is wrong, **Save** (a new PDF is made), then **Mark checked**. Any later change sends the form back to *To check*. Assistants and agents can fill and edit forms, never check them.
4. **Download** gives the filled PDF. Its fields stay fillable, so it can still be edited in any PDF reader before printing.

Text is written in Sarabun, the Thai government typeface, so Thai and Latin both print.

## Adjusting a template's form

On the template, **Forms and files**, each PDF form or letter shows how many fields EzVisa fills. **Fields** opens the form with its fields drawn on the pages:

- Change a field's label, where its value comes from, how it is written, and a hint for whoever fills it.
- On a scan EzVisa made fillable, drag a box to move it, pull its corner to resize it, **Add a box** and draw it on the page, or remove one.
- **Start over** has Claude read the form again and replaces the fields.

Changes apply to the next fill of every case using that form, including open ones. Values already entered by a person stay.

## Over MCP

`get_template_form`, `set_up_template_form`, `update_template_form`, `list_case_forms`, `prepare_case_forms`, `get_case_form`, `read_case_form` (the filled PDF itself), `update_case_form` and `check_case_form` (people only). Setting up and filling run in the background: check back with `get_template_form` or `list_case_forms`.

## Setup and cost

It uses the `ANTHROPIC_API_KEY` already set for the agents, with Claude Opus 5.5 (`FORMS_MODEL` changes it). Without a key, forms with their own fields are still filled from the records, flat PDFs cannot be set up, and fields Claude would read from documents stay empty for the team.

Each template PDF costs two requests once (finding and describing the fields). Each case costs one request per new document, plus one per form with fields read from documents. Documents are read at most once, and at most 15 per fill.

The PDF previews load the files from the bucket in the browser, so the bucket's CORS rule allows GET from the dashboard as well as PUT. The server sets it at start.
