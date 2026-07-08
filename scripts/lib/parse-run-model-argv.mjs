/** CLI flags that consume the following argv token (not positional models). */
const FLAGS_WITH_VALUE = new Set([
  "--prompts",
  "--input",
  "-i",
  "-o",
  "--benchmark",
]);

/**
 * Split optional judge/user models from flags (e.g. `--prompts default,child`).
 * @param {string[]} args - argv after the target model
 */
export function parseRunModelArgv(args) {
  const positional = [];
  const extraArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (FLAGS_WITH_VALUE.has(arg)) {
      extraArgs.push(arg);
      if (i + 1 < args.length) {
        extraArgs.push(args[++i]);
      }
      continue;
    }
    if (arg.startsWith("-")) {
      extraArgs.push(arg);
      continue;
    }
    positional.push(arg);
  }

  return {
    judgeModel: positional[0],
    userModel: positional[1],
    extraArgs,
  };
}
