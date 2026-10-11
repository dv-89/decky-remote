import type { HTMLAttributes, InputHTMLAttributes } from "react";
export function DialogButton(props: HTMLAttributes<HTMLButtonElement> & { disabled?: boolean }) { return <button {...props} />; }
export function Focusable({ onCancel: _cancel, ...props }: HTMLAttributes<HTMLDivElement> & { onCancel?: unknown }) { return <div {...props} />; }
export function TextField({ label, bShowCopyAction, value, onChange }: InputHTMLAttributes<HTMLInputElement> & { label?: string; bShowCopyAction?: boolean }) {
  return <label>{label}<div style={{ display: "flex", gap: 8 }}><input value={value} onChange={onChange} readOnly={!onChange} />{bShowCopyAction && <button onClick={() => { void navigator.clipboard.writeText(String(value)); }}>Copy path</button>}</div></label>;
}
export const Navigation = { NavigateBack: () => { document.title = "Back to Steam (simulated)"; } };
