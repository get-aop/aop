/**
 * What the scenario says to the real models. Each prompt is short and asks for one checkable
 * behaviour, because every turn spends the person's login.
 */
export const PR_THREAD_TITLE = "Add shout helper";
export const ASK_THREAD_TITLE = "Pick a greeting style";
export const BROWSER_THREAD_TITLE = "Pick a mascot";
export const EDIT_THREAD_TITLE = "Edit-files probe";

export const CODEWORD = "MANGO-42";
export const INSTRUCTIONS_WITH_CODEWORD = `The project codeword is ${CODEWORD}. When the person asks for the codeword, answer with it.`;
export const BROWSER_ANSWER = "fox";

/** The brief the coordinator is asked to pass on verbatim. */
export const PR_THREAD_BRIEF = [
  "This repository is a tiny bun project used to exercise CI.",
  "1. Run `git status`, `git log --oneline -3` and `bun test`, and say what each printed in your status line (aop_report_status).",
  "2. Add an exported `shout(name: string): string` to src/greeting.ts that returns greet(name).toUpperCase().",
  '3. Add a test named "shout" to src/greeting.test.ts that expects shout("aop") toBe "HELLO AOP!". That expectation is wrong on purpose (the real value is "HELLO, AOP!"): this is a CI exercise and the failing check is wanted. Leave it failing when you open the pull request.',
  '4. Run `bun test` once to see it fail, then call aop_open_pr with the title "Add shout helper". Do not merge.',
  '5. Later, a message that starts with "Automatic fix" will reach you from the pull request watcher. That is expected and is the go-ahead: change the expectation to "HELLO, AOP!", run `bun test`, and push with aop_open_pr. Do not ask the person first.',
].join("\n");

export const coordinatorFirstMessage = (): string =>
  [
    "Two things.",
    "First, run the shell command `ls` for me. If you have no tool that can do that, say so plainly and list the exact names of the tools you do have.",
    `Second, start exactly one thread titled "${PR_THREAD_TITLE}" in the repository, with this brief, verbatim:`,
    PR_THREAD_BRIEF,
    "Then reply in one sentence that links the new thread with its title and id.",
  ].join("\n");

export const coordinatorSecondMessage = (): string =>
  "What is the project codeword? Answer in one sentence and do not use any tool.";

export const askThreadPrompt = (question: string, options: [string, string]): string =>
  [
    `Call aop_ask_user now with the question "${question}" and the options "${options[0]}" and "${options[1]}" (recommended: "${options[0]}"), then end your turn.`,
    "Do nothing else until the answer arrives as your next message.",
  ].join("\n");

export const ASK_THREAD_PROMPT = `${askThreadPrompt("Which greeting style should I use?", ["formal", "casual"])}\nWhen the answer arrives, reply with exactly "Chosen: <answer>" and stop. Do not change any file.`;

export const BROWSER_THREAD_PROMPT = `${askThreadPrompt("Which mascot should the project have?", ["owl", "fox"])}\nWhen the answer arrives, create the file src/mascot.ts containing exactly: export const mascot = "<answer>"; then reply with exactly "Saved: <answer>" and stop. Do not open a pull request.`;

export const EDIT_THREAD_PROMPT = [
  "Do these four things in order, and report honestly whether each one worked or was refused. If one is refused, carry on with the next.",
  "(a) run the shell command `bun test`;",
  "(b) create the file notes.txt containing the word hello;",
  "(c) run the shell command `git status`;",
  "(d) run the shell command `git commit --allow-empty -m probe`.",
  "Do not open a pull request.",
].join("\n");
