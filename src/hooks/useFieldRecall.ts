import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldHistory, pushFieldHistory } from "../lib/fieldHistory";
import { nextRecall } from "../lib/studio/jumpHistory";

/**
 * The recall wiring for ANY text field — «هر وقت وارد فیلدی میشی بیاد و
 * برگرده عقب». While the field is FOCUSED and has history, the caller shows
 * a small arrow button (`recall.recall` on click); Backspace on the empty
 * field does the same (desktop keydown + native beforeinput for Persian
 * mobile IMEs, which skip keydown on empty inputs). Values are recorded on
 * blur / Enter (`commit`), deduped newest-first.
 *
 * The recall chain works exactly like the studio jump search: the restored
 * text arrives fully SELECTED, so typing replaces it and the next Backspace
 * clears it — a natural step-by-step rhythm back through the field's past.
 */
export function useFieldRecall(opts: {
  /** Stable identity of this field (explicit id, or derived from placeholder). */
  key: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { key, value, onChange } = opts;

  const [history, setHistory] = useState<string[]>(() => getFieldHistory(key));
  const [focused, setFocused] = useState(false);

  const cursor = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const valueRef = useRef(value);
  valueRef.current = value;
  const historyRef = useRef(history);
  historyRef.current = history;

  /** One step back through this field's previous values (arrow or backspace). */
  const recall = useCallback(() => {
    const { query: q, next } = nextRecall(historyRef.current, cursor.current);
    if (q === null) return;
    cursor.current = next;
    onChange(q);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [onChange]);
  const recallRef = useRef(recall);
  recallRef.current = recall;

  /** Record the current value (blur / Enter). Empty values are ignored. */
  const commit = useCallback(() => {
    const v = valueRef.current.trim();
    cursor.current = 0;
    if (v) setHistory(pushFieldHistory(key, v));
  }, [key]);

  /* Mobile backspace: Persian IMEs usually do NOT fire keydown on an empty
   * input — the native beforeinput (deleteContentBackward) still fires. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.inputType === "deleteContentBackward" && el.value === "") {
        e.preventDefault();
        recallRef.current();
      }
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  /** True when it consumed the event: Backspace on the empty field → recall. */
  const backspaceOnEmpty = useCallback((e: React.KeyboardEvent<HTMLInputElement>): boolean => {
    if (e.key === "Backspace" && valueRef.current === "") {
      e.preventDefault();
      recallRef.current();
      return true;
    }
    return false;
  }, []);

  /** Wrap the field's onChange: typing (non-empty) restarts the chain;
   *  CLEARING a recalled value keeps the cursor so the next Backspace keeps
   *  stepping back. */
  const handleChange = useCallback(
    (v: string) => {
      if (v !== "") cursor.current = 0;
      onChange(v);
    },
    [onChange],
  );

  return {
    inputRef,
    focused,
    hasHistory: history.length > 0,
    recall,
    commit,
    handleChange,
    onFocus: useCallback(() => setFocused(true), []),
    onBlur: useCallback(() => {
      setFocused(false);
      commit();
    }, [commit]),
    backspaceOnEmpty,
  };
}
