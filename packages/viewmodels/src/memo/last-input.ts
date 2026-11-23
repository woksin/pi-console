/**
 * Memoizes a function on only its most recent arguments (compared with `Object.is`). The cache never grows, so a view
 * can keep structure for the current inputs without retaining every historical filter or collapsed set.
 */
export function lastInput<A extends readonly unknown[], R>(compute: (...args: A) => R): (...args: A) => R {
  let inputs: A | undefined;
  let result: R;
  return (...args: A): R => {
    if (inputs?.length === args.length && inputs.every((value, index) => Object.is(value, args[index]))) return result;
    result = compute(...args);
    inputs = args;
    return result;
  };
}
