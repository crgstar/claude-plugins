import type { RenderSurface, SessionAppendInput } from 'claude-code'

// 使用量をどこに描くかの判断。register から切り離しているのは、画面と会話の行の組み合わせをテストで網羅するため

// プロンプト下の右端 (SessionMode) が描かれる画面。型定義に「terminal と desktop だけ」とある
const SESSION_MODE_SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']

// プロンプト下の右端が描かれない画面 (スマホ・VS Code) では、代わりに最後の応答の下へ開閉ボタンを出す
export const showsUsageButton = (surface: RenderSurface): boolean => !SESSION_MODE_SURFACES.includes(surface)

// 開閉ボタンを付ける先になる行か。応答の描画 (AssistantMessage) はこの行ごとに呼ばれ、その requestId はこの行の uuid と同じ。
// 思考だけ・ツール呼び出しだけの行は本文として描かれない。サブエージェントの行は画面の会話に出ない
export const isReplyTextRow = (row: Pick<SessionAppendInput, 'message' | 'agentId'>): boolean =>
  row.agentId === undefined &&
  row.message.type === 'assistant' &&
  row.message.content.some((block) => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
