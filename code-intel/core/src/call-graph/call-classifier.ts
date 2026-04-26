export type CallKind = 'free' | 'member' | 'constructor';

export interface CallSite {
  callerNodeId: string;
  callerFilePath: string;
  name: string;
  receiverText?: string;
  kind: CallKind;
  line: number;
  argCount: number;
}

export function classifyCall(
  name: string,
  hasReceiver: boolean,
  isNew: boolean,
): CallKind {
  if (isNew) return 'constructor';
  if (hasReceiver) return 'member';
  if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
    return 'constructor';
  }
  return 'free';
}
