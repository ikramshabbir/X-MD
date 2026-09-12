import { kvGet, kvSet, kvDel } from "./botKv.js";

function memoryKey(userId) {
  return `ai_memory:${userId}`;
}

export async function getAiMemory(userId) {
  if (!userId) return [];

  const data = await kvGet(memoryKey(userId));

  if (!Array.isArray(data)) return [];

  return data;
}

export async function addAiMemory(userId, text) {
  if (!userId || !text) return [];

  const memory = await getAiMemory(userId);

  memory.push({
    text: String(text).trim(),
    savedAt: new Date().toISOString(),
  });

  // Maximum 20 memories per user
  const limited = memory.slice(-20);

  await kvSet(memoryKey(userId), limited);

  return limited;
}

export async function clearAiMemory(userId) {
  if (!userId) return;

  await kvDel(memoryKey(userId));
}
