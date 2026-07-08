import { test, expect, describe, beforeEach, vi } from "vitest";
import { resetDbForTesting, getDb, runMigrations } from "../../../core/db.js";
import { channelModule } from "../index.js";
import { channelService } from "../service.js";
import type { Context as GrammyContext } from "grammy";
import type { Message } from "grammy/types";

beforeEach(() => {
  resetDbForTesting();
  process.env.DB_PATH = ":memory:";
  runMigrations(getDb(), [channelModule]);
});

const CHAT = -1001234567890;

function makeChannelPost(overrides: Partial<Message> = {}): GrammyContext {
  const msg = {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: CHAT, type: "channel", title: "Skye Updates" },
    sender_chat: { id: CHAT, type: "channel", title: "Skye Updates" },
    text: "Hello channel",
    ...overrides,
  } as unknown as Message;

  const ctx = {
    channelPost: msg,
    editedChannelPost: undefined,
    chat: msg.chat,
  } as unknown as GrammyContext;
  return ctx;
}

describe("channel service", () => {
  test("capture a text channel post", () => {
    const ctx = makeChannelPost({ message_id: 10, text: "First post" });
    const post = channelService.capture(ctx);

    expect(post).toBeDefined();
    expect(post!.chatId).toBe(CHAT);
    expect(post!.messageId).toBe(10);
    expect(post!.text).toBe("First post");
    expect(post!.sender).toBe("Skye Updates");
    expect(post!.deletedAt).toBeNull();
  });

  test("capture is idempotent on re-delivery", () => {
    const ctx = makeChannelPost({ message_id: 11, text: "Once" });
    channelService.capture(ctx);
    channelService.capture(ctx);

    const count = channelService.count(CHAT);
    expect(count).toBe(1);
  });

  test("edited post updates text and stamps edited_at", () => {
    const ctx = makeChannelPost({ message_id: 12, text: "Original" });
    channelService.capture(ctx);

    const editedCtx = {
      editedChannelPost: {
        message_id: 12,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT, type: "channel", title: "Skye Updates" },
        sender_chat: { id: CHAT, type: "channel", title: "Skye Updates" },
        text: "Edited text",
        edit_date: Math.floor(Date.now() / 1000),
      } as unknown as Message,
      channelPost: undefined,
      chat: { id: CHAT, type: "channel" },
    } as unknown as GrammyContext;
    const updated = channelService.capture(editedCtx);

    expect(updated).toBeDefined();
    expect(updated!.text).toBe("Edited text");
    expect(updated!.editedAt).not.toBeNull();
  });

  test("list returns posts in ascending message_id order", () => {
    channelService.capture(makeChannelPost({ message_id: 3, text: "three" }));
    channelService.capture(makeChannelPost({ message_id: 1, text: "one" }));
    channelService.capture(makeChannelPost({ message_id: 2, text: "two" }));

    const list = channelService.list(CHAT);
    expect(list).toHaveLength(3);
    expect(list.map((p) => p.messageId)).toEqual([1, 2, 3]);
  });

  test("markDeleted hides a post from list and count", () => {
    channelService.capture(makeChannelPost({ message_id: 20, text: "bye" }));
    const ok = channelService.markDeleted(CHAT, 20);
    expect(ok).toBe(true);

    expect(channelService.list(CHAT)).toHaveLength(0);
    expect(channelService.count(CHAT)).toBe(0);

    const again = channelService.markDeleted(CHAT, 20);
    expect(again).toBe(false);
  });

  test("get returns the post by message id", () => {
    channelService.capture(makeChannelPost({ message_id: 30, text: "find me" }));
    const post = channelService.get(CHAT, 30);
    expect(post).toBeDefined();
    expect(post!.text).toBe("find me");
  });

  test("capture handles media posts with caption", () => {
    const ctx = makeChannelPost({
      message_id: 40,
      text: undefined,
      photo: [{ file_id: "x", file_unique_id: "x", width: 1, height: 1 }],
      caption: "photo caption",
    } as unknown as Message);
    const post = channelService.capture(ctx);
    expect(post).toBeDefined();
    expect(post!.mediaType).toBe("photo");
    expect(post!.mediaCaption).toBe("photo caption");
    expect(post!.text).toBeNull();
  });

  test("capture handles media posts without caption", () => {
    const ctx = makeChannelPost({
      message_id: 41,
      text: undefined,
      video: {
        file_id: "v",
        file_unique_id: "v",
        width: 1,
        height: 1,
        duration: 1,
      },
    } as unknown as Message);
    const post = channelService.capture(ctx);
    expect(post).toBeDefined();
    expect(post!.mediaType).toBe("video");
    expect(post!.mediaCaption).toBeNull();
  });
});

// Silence unused-import warnings for vi if not used elsewhere.
void vi;
