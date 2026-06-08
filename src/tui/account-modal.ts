import { Canvas } from "./render-core/canvas.js";
import { center, rect } from "./render-core/layout.js";
import { textStyle, theme } from "./render-core/theme.js";

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
  action: "logout" | "cache-cleanup";
}

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
    textStyle.primaryBold("账号登录与切换"),
    textStyle.muted("选择已有账号，或新建一个登录"),
    ""
  ];

  state.accounts.forEach((account, index) => {
    const selected = index === state.selectedIndex;
    const marker = selected ? textStyle.primary(theme.marker.pointer) : " ";
    const current = account.isCurrent ? ` ${textStyle.ok("[当前]")}` : "";
    rows.push(`${marker} ${account.account}  ${textStyle.muted(account.detail)}${current}`);
  });

  const addSelected = state.selectedIndex === state.accounts.length;
  rows.push(`${addSelected ? textStyle.primary(theme.marker.pointer) : " "} ${textStyle.primary("新账号登录")}`);
  rows.push("");
  rows.push(textStyle.muted("Enter 选择  Esc 返回"));

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
    textStyle.primaryBold("终端内登录"),
    textStyle.muted("Tab/j/k 切换字段  Enter 下一项或提交"),
    "",
    ...fields,
    "",
    state.fieldIndex === 2
      ? textStyle.primaryBold(`> ${submit}`)
      : textStyle.muted(submit),
    state.error
      ? textStyle.danger(state.error)
      : textStyle.muted("Esc 返回账号列表")
  ];

  return drawFramedModal(baseLines, rows, width, height, 62);
}

export function drawConfirmModal(
  baseLines: string[],
  dialog: ConfirmDialogState,
  width: number,
  height: number
): string {
  const confirm = dialog.selectedIndex === 0 ? `> ${dialog.confirmLabel}` : `  ${dialog.confirmLabel}`;
  const cancel = dialog.selectedIndex === 1 ? `> ${dialog.cancelLabel}` : `  ${dialog.cancelLabel}`;
  const rows = [
    textStyle.dangerBold(dialog.title),
    "",
    dialog.detail,
    "",
    confirm,
    cancel,
    "",
    textStyle.muted("j/k 选择  Enter 确认  Esc 取消")
  ];

  return drawFramedModal(baseLines, rows, width, height, 54);
}

function renderField(label: string, value: string, active: boolean, placeholder: string): string {
  const content = value || textStyle.muted(placeholder);
  const text = `${label}: ${content}`;
  return active
    ? textStyle.primaryBold(`> ${stripAnsi(text)}`)
    : `  ${text}`;
}

function drawFramedModal(
  baseLines: string[],
  content: string[],
  width: number,
  height: number,
  preferredWidth: number
): string {
  const canvas = new Canvas(width, height);
  canvas.drawLines(rect(width, height), baseLines);
  const modal = center(rect(width, height), Math.min(preferredWidth + 4, width), Math.min(content.length + 4, height));
  if (modal.width < 4 || modal.height < 3) {
    return baseLines.slice(0, height).join("\n");
  }
  canvas.overlay(modal, content);
  return canvas.toString();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
