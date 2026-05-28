import { ansi, fg } from "./ansi.js";

export interface AccountModalState {
  accounts: AccountListItem[];
  selectedIndex: number;
}

export interface AccountListItem {
  account: string;
  detail: string;
  isCurrent: boolean;
}

export interface LoginFormState {
  username: string;
  password: string;
  fieldIndex: number;
  submitting: boolean;
  error?: string;
}

export interface ConfirmDialogState {
  title: string;
  detail: string;
  confirmLabel: string;
  cancelLabel: string;
  selectedIndex: number;
  action: "logout";
}

const cc98Blue = fg(0, 130, 202);
const muted = fg(139, 152, 166);
const line = fg(52, 84, 112);
const danger = fg(245, 101, 101);
const ok = fg(91, 207, 140);

export function createLoginForm(): LoginFormState {
  return {
    username: "",
    password: "",
    fieldIndex: 0,
    submitting: false
  };
}

export function updateLoginField(form: LoginFormState, update: (value: string) => string): void {
  if (form.fieldIndex === 0) {
    form.username = update(form.username);
  } else if (form.fieldIndex === 1) {
    form.password = update(form.password);
  }
}

export function isPrintableInput(key: string): boolean {
  return key.length === 1 && key >= " " && key !== "\x7f";
}

export function drawAccountModal(
  baseLines: string[],
  state: AccountModalState,
  width: number,
  height: number
): string {
  const rows = [
    `${cc98Blue}${ansi.bold}账号登录与切换${ansi.reset}`,
    `${muted}选择已有账号，或新建一个登录${ansi.reset}`,
    ""
  ];

  state.accounts.forEach((account, index) => {
    const selected = index === state.selectedIndex;
    const marker = selected ? `${cc98Blue}›${ansi.reset}` : " ";
    const current = account.isCurrent ? ` ${ok}[当前]${ansi.reset}` : "";
    rows.push(`${marker} ${account.account}  ${muted}${account.detail}${ansi.reset}${current}`);
  });

  const addSelected = state.selectedIndex === state.accounts.length;
  rows.push(`${addSelected ? `${cc98Blue}›${ansi.reset}` : " "} ${cc98Blue}新账号登录${ansi.reset}`);
  rows.push("");
  rows.push(`${muted}Enter 选择  Esc 返回${ansi.reset}`);

  return drawFramedModal(baseLines, rows, width, height, 58);
}

export function drawLoginModal(
  baseLines: string[],
  state: LoginFormState,
  width: number,
  height: number
): string {
  const fields = [
    renderField("用户名", state.username, state.fieldIndex === 0, "输入 CC98 用户名"),
    renderField("密码", state.password ? "*".repeat(Math.max(8, state.password.length)) : "", state.fieldIndex === 1, "输入密码")
  ];

  const submit = state.submitting ? "正在登录..." : "提交登录";
  const rows = [
    `${cc98Blue}${ansi.bold}终端内登录${ansi.reset}`,
    `${muted}Tab/j/k 切换字段  Enter 下一项或提交${ansi.reset}`,
    "",
    ...fields,
    "",
    state.fieldIndex === 2
      ? `${cc98Blue}${ansi.bold}> ${submit}${ansi.reset}`
      : `${muted}${submit}${ansi.reset}`,
    state.error
      ? `${danger}${state.error}${ansi.reset}`
      : `${muted}Esc 返回账号列表${ansi.reset}`
  ];

  return drawFramedModal(baseLines, rows, width, height, 62);
}

export function drawConfirmModal(
  baseLines: string[],
  dialog: ConfirmDialogState,
  width: number,
  height: number
): string {
  const confirm = dialog.selectedIndex === 0
    ? `${cc98Blue}${ansi.bold}> ${dialog.confirmLabel}${ansi.reset}`
    : `${muted}${dialog.confirmLabel}${ansi.reset}`;
  const cancel = dialog.selectedIndex === 1
    ? `${cc98Blue}${ansi.bold}> ${dialog.cancelLabel}${ansi.reset}`
    : `${muted}${dialog.cancelLabel}${ansi.reset}`;
  const rows = [
    `${danger}${ansi.bold}${dialog.title}${ansi.reset}`,
    "",
    dialog.detail,
    "",
    `${confirm}  ${cancel}`,
    `${muted}Enter 确认  Esc 取消${ansi.reset}`
  ];

  return drawFramedModal(baseLines, rows, width, height, 54);
}

function renderField(label: string, value: string, active: boolean, placeholder: string): string {
  const content = value || `${muted}${placeholder}${ansi.reset}`;
  const text = `${label}: ${content}`;
  return active
    ? `${cc98Blue}${ansi.bold}> ${stripAnsi(text)}${ansi.reset}`
    : `  ${text}`;
}

function drawFramedModal(
  baseLines: string[],
  content: string[],
  width: number,
  height: number,
  preferredWidth: number
): string {
  const innerWidth = Math.min(preferredWidth, Math.max(26, width - 8));
  const modalWidth = innerWidth + 4;
  const modalHeight = Math.min(height - 4, content.length + 4);
  const startRow = Math.floor((height - modalHeight) / 2);
  const startCol = Math.floor((width - modalWidth) / 2);
  const result = [...baseLines];

  const rows: string[] = [];
  rows.push(`${line}╭${"─".repeat(modalWidth - 2)}╮${ansi.reset}`);
  rows.push(`${line}│${ansi.reset} ${fit("", modalWidth - 4)} ${line}│${ansi.reset}`);

  for (let index = 0; index < modalHeight - 4; index += 1) {
    const entry = content[index] ?? "";
    const padded = fit(entry, innerWidth);
    rows.push(
      `${line}│${ansi.reset} ${padded} ${line}│${ansi.reset}`
    );
  }

  rows.push(`${line}│${ansi.reset} ${fit("", modalWidth - 4)} ${line}│${ansi.reset}`);
  rows.push(`${line}╰${"─".repeat(modalWidth - 2)}╯${ansi.reset}`);

  rows.forEach((rowValue, index) => {
    const row = startRow + index;
    if (row < 0 || row >= result.length) {
      return;
    }
    result[row] = composeCenteredRow(rowValue, startCol, width);
  });

  return result.slice(0, height).join("\n");
}

function composeCenteredRow(content: string, startCol: number, width: number): string {
  const left = " ".repeat(Math.max(0, startCol));
  const used = startCol + cellWidth(content);
  const right = " ".repeat(Math.max(0, width - used));
  return `${left}${content}${right}`;
}

function fit(value: string, width: number): string {
  const trimmed = truncate(value, width);
  const missing = Math.max(0, width - cellWidth(trimmed));
  return `${trimmed}${" ".repeat(missing)}`;
}

function truncate(value: string, width: number): string {
  if (cellWidth(value) <= width) {
    return value;
  }

  let current = "";
  let currentWidth = 0;
  const plain = [...value];
  for (const char of plain) {
    const charWidth = cellWidth(char);
    if (currentWidth + charWidth > Math.max(0, width - 1)) {
      break;
    }
    current += char;
    currentWidth += charWidth;
  }
  return `${current}…`;
}

function cellWidth(value: string): number {
  let width = 0;
  let inEscape = false;
  for (const char of value) {
    if (char === "\u001b") {
      inEscape = true;
      continue;
    }
    if (inEscape) {
      if (char === "m") {
        inEscape = false;
      }
      continue;
    }
    width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(char) ? 2 : 1;
  }
  return width;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
