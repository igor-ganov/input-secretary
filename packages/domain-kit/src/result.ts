export type Ok<T> = { readonly kind: "ok"; readonly value: T };
export type Err<E> = { readonly kind: "err"; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ kind: "ok", value });
export const err = <E>(error: E): Err<E> => ({ kind: "err", error });

export const matchResult =
  <T, E, R>(cases: { readonly ok: (value: T) => R; readonly err: (error: E) => R }) =>
  (result: Result<T, E>): R => {
    switch (result.kind) {
      case "ok":
        return cases.ok(result.value);
      case "err":
        return cases.err(result.error);
    }
  };
