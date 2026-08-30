import { createCliContext } from "../context.js";
import { extractAccountOption } from "../options.js";
import {
  parseNonNegativeInteger,
  parsePositiveInteger,
  printJson
} from "../parse.js";

export async function favoriteCommand(args: string[]): Promise<void> {
  const accountOption = extractAccountOption(args);
  const [subcommand, ...rest] = accountOption.args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    printFavoriteHelp();
    return;
  }

  const { client } = await createCliContext({ account: accountOption.account });

  switch (subcommand) {
    case "list": {
      const options = parseListOptions(rest);
      printJson(await client.getFavoriteTopics(options.from, options.size, options.order, options.groupId));
      return;
    }
    case "add": {
      const topicId = parsePositiveInteger(rest[0], "topic-id");
      const groupId = parseGroupOption(rest.slice(1));
      printJson(await client.favoriteTopic(topicId, groupId));
      return;
    }
    case "remove": {
      const topicId = parsePositiveInteger(rest[0], "topic-id");
      printJson(await client.unfavoriteTopic(topicId));
      return;
    }
    case "groups":
      printJson(await client.getFavoriteGroups());
      return;
    case "group": {
      const [action, ...groupArgs] = rest;
      if (action === "create") {
        const name = groupArgs.join(" ").trim();
        if (!name) {
          throw new Error("usage: cc98 favorite group create <name>");
        }
        printJson(await client.createFavoriteGroup(name));
        return;
      }
      if (action === "rename") {
        const groupId = parsePositiveInteger(groupArgs[0], "group-id");
        const name = groupArgs.slice(1).join(" ").trim();
        if (!name) {
          throw new Error("usage: cc98 favorite group rename <id> <name>");
        }
        printJson(await client.updateFavoriteGroup(groupId, name));
        return;
      }
      if (action === "delete") {
        const groupId = parsePositiveInteger(groupArgs[0], "group-id");
        printJson(await client.deleteFavoriteGroup(groupId));
        return;
      }
      throw new Error(`unknown favorite group command: ${action ?? ""}`);
    }
    case "board": {
      const [action, ...boardArgs] = rest;
      const boardId = parsePositiveInteger(boardArgs[0], "board-id");
      if (action === "add") {
        printJson(await client.addBoardFavorite(boardId));
        return;
      }
      if (action === "remove") {
        printJson(await client.removeBoardFavorite(boardId));
        return;
      }
      throw new Error(`unknown favorite board command: ${action ?? ""}`);
    }
    default:
      throw new Error(`unknown favorite command: ${subcommand}`);
  }
}

function parseListOptions(args: string[]): { from: number; size: number; order: number; groupId: number } {
  let from = 0;
  let size = 11;
  let order = 0;
  let groupId = 0;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--from") {
      from = parseNonNegativeInteger(args[index + 1], "--from");
      index += 1;
      continue;
    }

    if (arg === "--size") {
      size = parsePositiveInteger(args[index + 1], "--size");
      index += 1;
      continue;
    }

    if (arg === "--order") {
      order = parseNonNegativeInteger(args[index + 1], "--order");
      index += 1;
      continue;
    }

    if (arg === "--group") {
      groupId = parseNonNegativeInteger(args[index + 1], "--group");
      index += 1;
      continue;
    }

    throw new Error(`unknown favorite list option: ${arg}`);
  }

  return { from, size, order, groupId };
}

function parseGroupOption(args: string[]): number {
  let groupId = 0;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--group") {
      groupId = parseNonNegativeInteger(args[index + 1], "--group");
      index += 1;
      continue;
    }

    throw new Error(`unknown favorite add option: ${arg}`);
  }

  return groupId;
}

function printFavoriteHelp(): void {
  console.log(`cc98 favorite

Usage:
  cc98 favorite list [--group id] [--order n] [--from n] [--size n]
  cc98 favorite add <topic-id> [--group id]
  cc98 favorite remove <topic-id>
  cc98 favorite groups
  cc98 favorite group create <name>
  cc98 favorite group rename <id> <name>
  cc98 favorite group delete <id>
  cc98 favorite board add <board-id>
  cc98 favorite board remove <board-id>

Output:
  Default output is JSON.
`);
}
