import { createCliContext } from "../context.js";
import { extractAccountOption } from "../options.js";
import { parseInteger, parsePositiveInteger, printJson } from "../parse.js";
import { openTopicPostDraft, postTopicDirectly } from "./post-draft.js";

export async function postCommand(args: string[]): Promise<void> {
  const accountOption = extractAccountOption(args);
  const postOptions = parsePostOptions(accountOption.args);
  const [subcommand, ...rest] = postOptions.args;
  const { client } = await createCliContext({ account: accountOption.account });

  switch (subcommand) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      printPostHelp();
      return;
    case "reaction-state": {
      const postId = parsePositiveInteger(rest[0], "post-id");
      printJson(await client.getPostReactionState(postId));
      return;
    }
    case "rate-reasons": {
      const type = parseInteger(rest[0], "type");
      printJson(await client.getPostRateReasons(type));
      return;
    }
    default:
      if (subcommand && rest[0]) {
        // rest: [markdownFile, tag1?, tag2?]
        const [markdownFile, tag1, tag2] = rest;
        if (postOptions.browser) {
          await openTopicPostDraft(client, subcommand, markdownFile, {
            browser: postOptions.browser
          });
        } else {
          await postTopicDirectly(client, subcommand, markdownFile, tag1, tag2, postOptions.ubb);
        }
        return;
      }
      throw new Error(`unknown post command: ${subcommand}`);
  }
}

function parsePostOptions(args: string[]): { args: string[]; browser?: string; ubb: boolean } {
  const rest: string[] = [];
  let browser: string | undefined;
  let ubb = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--browser") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("missing value for --browser");
      }
      browser = value.trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--ubb") {
      ubb = true;
      continue;
    }
    rest.push(arg);
  }

  return { args: rest, browser, ubb };
}

function printPostHelp(): void {
  console.log(`cc98 post

Usage:
  cc98 post <board-id|board-name> <markdown-file> [tag1] [tag2] [--ubb]
  cc98 post <board-id|board-name> <markdown-file> --browser safari
  cc98 post <board-id|board-name> <markdown-file> --browser chrome
  cc98 post reaction-state <post-id>
  cc98 post rate-reasons <type>

Options:
  --browser safari|chrome    Open a prefilled editor draft (Safari autofills)
  --ubb                      Post as UBB (default is Markdown)

Description:
  Without --browser, the post is published directly via the CC98 API.
  tag1/tag2 are optional tag names for boards that require them.
  With --browser, it opens the web editor. Safari supports autofill.
`);
}
