import type { RuntimeContext } from "./context.js";
import { openMyFavorites } from "../data/favorites.js";
import { openMyFans, openMyHistory, openMyProfile, openMyReplies } from "../data/me.js";
import { describeUserProfileStatus } from "../data/view-items.js";

export function openSelectedMeItem(context: RuntimeContext): boolean {
  const { state, render, client, nextSignal } = context;
  const selected = state.items[state.itemIndex];
  if (selected?.action === "me.profile") {
    void openMyProfile(client, state, render, false, nextSignal());
    return true;
  }
  if (selected?.action === "me.favorites") {
    void openMyFavorites(client, state, render, true, nextSignal());
    return true;
  }
  if (selected?.action === "me.replies") {
    void openMyReplies(client, state, render, false, nextSignal());
    return true;
  }
  if (selected?.action === "me.history") {
    void openMyHistory(client, state, render, false, nextSignal());
    return true;
  }
  if (selected?.action === "me.fans") {
    void openMyFans(client, state, render, false, nextSignal());
    return true;
  }
  return false;
}

export function refreshCurrentMeView(context: RuntimeContext): boolean {
  const { state, render, client, nextSignal } = context;
  if (state.currentFeed?.kind === "me-profile") {
    void openMyProfile(client, state, render, true, nextSignal(), false);
    return true;
  }
  if (state.currentFeed?.kind === "me-favorites") {
    void openMyFavorites(client, state, render, true, nextSignal(), false);
    return true;
  }
  if (state.currentFeed?.kind === "me-replies") {
    void openMyReplies(client, state, render, true, nextSignal(), false);
    return true;
  }
  if (state.currentFeed?.kind === "me-history") {
    void openMyHistory(client, state, render, true, nextSignal(), false);
    return true;
  }
  if (state.currentFeed?.kind === "me-fans") {
    void openMyFans(client, state, render, true, nextSignal(), false);
    return true;
  }
  return false;
}

export async function toggleCurrentUserFollow(context: RuntimeContext): Promise<void> {
  const { state, render, client } = context;
  const currentUser = state.currentUser;
  if (!currentUser || state.currentFeed?.kind === "me-profile" || state.loading || state.loadingMore) {
    return;
  }

  const nextFollowState = !currentUser.isFollowed;
  state.status = nextFollowState ? "正在关注用户..." : "正在取消关注...";
  render();

  try {
    if (nextFollowState) {
      await client.followUser(currentUser.userId);
    } else {
      await client.unfollowUser(currentUser.userId);
    }
    currentUser.isFollowed = nextFollowState;
    state.status = describeUserProfileStatus(state);
    state.notification = {
      message: nextFollowState ? "已关注当前用户" : "已取消关注当前用户",
      expiresAt: Date.now() + 2200
    };
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = nextFollowState ? "关注失败" : "取消关注失败";
  } finally {
    render();
  }
}
