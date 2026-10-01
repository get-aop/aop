import { oneLine } from "./prompt-text.ts";

/**
 * What a new project's kickoff says: the welcome the host posts in the coordinator's name, the
 * brief of the read-only survey thread, and what the coordinator is asked once the survey
 * reports. Pure text; kickoff.ts decides when each is used.
 */

const NAME_MAX_CHARS = 100;
const GOAL_MAX_CHARS = 2000;

const WELCOME_OPENING = [
  "Welcome to your new project. I coordinate the work here: ask for whatever you need, and I'll either answer you directly or start threads to work on things in parallel.",
  "Threads do the work on their own, and the threads panel shows how each one is doing. I'll keep an eye on what's running and post an update when something finishes or needs you.",
];

/** The welcome: with a survey it says what the coordinator is looking at, without one what to do next. */
export const kickoffWelcome = (projectName: string, surveying: boolean): string =>
  [
    ...WELCOME_OPENING,
    surveying
      ? `To find good next steps, I'll look at what ${oneLine(projectName, NAME_MAX_CHARS)} does and what's in flight in it.`
      : "This project has no repository yet, so there is nothing for me to look at. Tell me what you want done, or attach a repository in the project's settings.",
  ].join("\n\n");

export const surveyTitle = (projectName: string): string =>
  `What ${oneLine(projectName, NAME_MAX_CHARS)} does and what's in flight`;

/** The survey thread's first message. It runs read-only (see thread/thread-session.ts), and the brief says so too. */
export const surveyBrief = (projectName: string): string =>
  [
    `Look around ${oneLine(projectName, NAME_MAX_CHARS)} so the coordinator can suggest good next steps. This is a read-only look: do not change files, commit, or open a pull request.`,
    "",
    "Find out:",
    "- What the project does and how it is built: the README, the docs, the main entry points.",
    "- What is in flight: recent commits, open branches and pull requests, open issues, failing builds or tests, and work that looks half done. Read-only commands such as git log, git branch and gh pr list help here.",
    "",
    "Keep your checklist and status line current with aop_report_status. When you are done, reply with a short report: two or three sentences on what the project is, then what is in flight, each item with where you saw it. End with up to four threads worth starting now, each with one line on why.",
  ].join("\n");

/**
 * Added to the survey's first report: what the coordinator does with it. The link to the survey
 * is written out, so the summary it asks for points at the thread with a chip.
 */
export const surveyReportAsk = (survey: { id: string; title: string }, goal: string): string => {
  const trimmedGoal = goal.trim();
  return [
    "This was your first look at the project, started by AOP when the project was created; the person has not asked for anything yet. Answer the person:",
    `1. In two or three plain sentences, say what the project is and what is in flight in it, and point to the details in [${oneLine(survey.title, NAME_MAX_CHARS * 2)}](thread:${survey.id}).`,
    '2. Then write "A few things I could pick up now:" and call propose_threads with two to four threads worth starting now, each with a complete brief and a one-line reason. Start none of them yourself.',
    ...(trimmedGoal
      ? [`Weigh them against the goal the person set: ${oneLine(trimmedGoal, GOAL_MAX_CHARS)}`]
      : []),
  ].join("\n");
};
