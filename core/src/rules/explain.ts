/**
 * Why each rule exists.
 *
 * A finding tells you what to change. This tells you what happens if you do
 * not, which is the part that decides whether anyone acts on it. Entries are
 * written as an attack, not a policy: "someone opens a pull request" beats
 * "violates least privilege".
 */

export interface RuleNote {
  /** The concrete path from this configuration to harm. */
  attack: string;
  /** Why the fix is the fix. */
  why: string;
}

export const RULE_NOTES: Record<string, RuleNote> = {
  'WL-SEC-001': {
    attack:
      'The key is in the repository. Anyone who clones it, any fork, any CI log that prints the file, and any model that reads it for context now holds a working credential.',
    why: 'Rotation is the only fix that helps; moving it to an environment variable afterwards stops the next copy.',
  },
  'WL-SEC-011': {
    attack:
      'A connection string with an inline password grants whatever that database role can do. Read access is usually the whole customer table.',
    why: 'Split the credential out and give the agent a read-only role scoped to the schemas it needs.',
  },
  'WL-SEC-013': {
    attack:
      'A hook that echoes a credential variable writes it into logs, CI output and terminal scrollback, where it outlives the session that had it.',
    why: 'Pass the secret straight to the process that needs it, never through a shell that records what it saw.',
  },
  'WL-SEC-014': {
    attack:
      'An agent with a broad Read permission opens .env like any other file. Nothing about that request looks unusual until the values appear in a model prompt.',
    why: 'Gitignore the file and deny reads of it explicitly, so the refusal is a rule rather than a hope.',
  },
  'WL-PRM-001': {
    attack:
      'Unscoped shell access makes every other permission decorative: the agent can read, write, install and exfiltrate through Bash regardless of what the rest of the list says.',
    why: 'Naming the commands you actually run costs a few minutes once and bounds every session afterwards.',
  },
  'WL-PRM-002': {
    attack:
      'An unrestricted write lets the agent edit CI workflows, git hooks and its own permission file. The next run starts from whatever it decided to write.',
    why: 'Scope writes to the source directories and deny .github and the agent config outright.',
  },
  'WL-PRM-003': {
    attack:
      'With nothing denied, a mistaken or injected tool call is bounded only by how broad the allow list happens to be.',
    why: 'A deny list is the backstop that survives someone widening an allow entry later to unblock a task.',
  },
  'WL-PRM-005': {
    attack:
      'Bypass mode removes the human from every decision at once, including the ones nobody anticipated when the config was written.',
    why: 'Grant specific permissions instead; the prompt is the only control that scales to unknown situations.',
  },
  'WL-PRM-006': {
    attack:
      'An unrestricted network client is both halves of an exfiltration: it pulls unreviewed code in and sends local data out, in one approved command.',
    why: 'Pin the host and the exact command, so a changed argument is a changed permission.',
  },
  'WL-PRM-009': {
    attack:
      'node -e and python -c take an entire program as their argument. Allowing them is allowing everything, however narrow the entry looks.',
    why: 'Allow the script files you run instead; a file can be reviewed, an inline string cannot.',
  },
  'WL-PRM-010': {
    attack:
      'Read access to a credential directory means the agent can put your keys into a model prompt without any step that looks like theft.',
    why: 'Deny the path. If one value is genuinely needed, inject that one value.',
  },
  'WL-PRM-012': {
    attack:
      'Auto-approval removes the confirmation step for actions nobody has seen yet, including the tool call a poisoned issue comment talked the model into making.',
    why: 'Approve categories of work through permissions, which are reviewable, rather than approving everything in advance.',
  },
  'WL-HOK-001': {
    attack:
      'Hook inputs are filenames, branch names and prompt text. An unquoted expansion turns a filename containing shell punctuation into a command.',
    why: 'Quoting is the whole fix, and it costs two characters.',
  },
  'WL-HOK-002': {
    attack:
      'Whoever controls that URL controls this machine, on every run, with no diff to review. The content can change after the last person read it.',
    why: 'Vendor the script and pin it, so the code that runs is the code that was reviewed.',
  },
  'WL-HOK-003': {
    attack:
      'An outbound request with interpolated values ships whatever the agent was working on - file contents, prompts, tokens - on every trigger.',
    why: 'If telemetry is genuinely needed, send a fixed payload you can read in the config.',
  },
  'WL-HOK-004': {
    attack:
      'A guard hook that swallows its own errors passes silently the moment it breaks. Everything downstream keeps reporting success.',
    why: 'Fail loudly. A check that cannot fail is not a check.',
  },
  'WL-HOK-005': {
    attack:
      'With nothing inspecting tool calls before they run, the permission list is the only defence and there is no record of what was attempted.',
    why: 'A PreToolUse hook is also the cheapest audit log you will ever add.',
  },
  'WL-HOK-006': {
    attack:
      'This is an interactive callback to a remote host. There is no legitimate version of it in a configuration file.',
    why: 'Treat the machine as compromised and rotate everything the agent could reach.',
  },
  'WL-HOK-007': {
    attack:
      'Anything the hook reads from a credential store is available to every later step of the session, including the ones that talk to the network.',
    why: 'Inject the single value that is needed, never the store.',
  },
  'WL-HOK-011': {
    attack:
      'These container flags hand the container the host. The sandbox stops being a boundary and becomes a formality.',
    why: 'Mount the one directory required and keep the default namespaces.',
  },
  'WL-HOK-013': {
    attack:
      'If the variable is ever empty, the target becomes the filesystem root. This is how a cleanup step deletes a home directory.',
    why: 'Delete a fixed path inside the project and quote it.',
  },
  'WL-HOK-015': {
    attack:
      'A hook that writes into a shell profile or a scheduled task outlives the agent session, and survives the config being deleted.',
    why: 'Startup configuration belongs in a reviewed dotfile, not in something that runs on its own.',
  },
  'WL-HOK-017': {
    attack:
      'Cloning the repository and opening it in the editor is enough to run this. No file opened, no command typed, no prompt shown.',
    why: 'Start the task deliberately. The convenience is not worth handing execution to anyone who can open a pull request.',
  },
  'WL-HOK-018': {
    attack:
      'An editor task that pipes a download into a shell is remote code execution triggered by opening a folder.',
    why: 'Vendor and pin the script, and invoke the local copy.',
  },
  'WL-MCP-001': {
    attack:
      'A shell server hands the model command execution as a tool call, which goes around the Bash permission list entirely.',
    why: 'Expose the specific operations you need, and keep confirmation on all of them.',
  },
  'WL-MCP-002': {
    attack:
      'A filesystem server mounted above the project can read SSH keys, browser profiles and every other repository on the machine.',
    why: 'Mount the repository directory, read-only where possible.',
  },
  'WL-MCP-003': {
    attack:
      'The server issues queries with whatever privileges its connection string carries. One injected tool call can drop or export real data.',
    why: 'Connect with a read-only role and keep writes on a reviewed path.',
  },
  'WL-MCP-005': {
    attack:
      'npx -y fetches and runs a package from a public registry with confirmation suppressed. A hijacked or typosquatted name executes before anyone sees a diff.',
    why: 'Install it as a dependency with a lockfile and launch from node_modules.',
  },
  'WL-MCP-007': {
    attack:
      'A literal token in the server environment travels with the config to every machine and every fork.',
    why: 'Reference the variable and supply it from the environment.',
  },
  'WL-MCP-008': {
    attack:
      'Everything passed to that server reaches an operator you do not control. Over plain HTTP it also reaches anyone on the path.',
    why: 'Use HTTPS at minimum, and prefer running the server locally.',
  },
  'WL-MCP-010': {
    attack:
      'Handing a server a path to .env or a private key puts the file contents inside the tool boundary, where the model can quote them back.',
    why: 'Pass the one value needed through the environment.',
  },
  'WL-MCP-012': {
    attack:
      'Auto-approved tools run without confirmation, which is exactly the control that catches a call the model was manipulated into making.',
    why: 'Auto-approve read-only tools only.',
  },
  'WL-AGT-001': {
    attack:
      'An agent with unrestricted tools turns any instruction it ingests, including one hidden in a file it reads, into an action.',
    why: 'List the tools the role needs and keep execution in a separate, deliberately invoked agent.',
  },
  'WL-AGT-002': {
    attack: 'Telling an agent to act without asking pre-approves actions nobody has seen yet.',
    why: 'Express the intent as a permission entry, where the scope is explicit and auditable.',
  },
  'WL-AGT-003': {
    attack:
      'Zero-width characters are invisible in an editor and in a diff, but the tokenizer reads them. Text can be hidden from every human reviewer while still instructing the model.',
    why: 'Strip them and check the git history for what was being concealed.',
  },
  'WL-AGT-006': {
    attack:
      'Fetching code from a URL and running it puts an unreviewed third party inside the agent loop, and the content can change after review.',
    why: 'Vendor the script and reference the local path.',
  },
  'WL-AGT-007': {
    attack:
      'Text designed to override earlier instructions is sitting in a file the model loads. Planted or pasted, its only function is to redirect the agent.',
    why: 'Remove it. If it documents an attack, fence it and label it as a sample.',
  },
  'WL-AGT-008': {
    attack:
      'An agent told to hide problems reports success it did not earn, and every check downstream inherits that.',
    why: 'Filter output by severity in the tooling, never by instructing the model to misreport.',
  },
  'WL-AGT-009': {
    attack:
      'Directing an agent to collect credentials puts them in the model context, where they travel with the conversation.',
    why: 'Secret discovery belongs in a scanner that redacts what it reports.',
  },
  'WL-AGT-010': {
    attack:
      'Behaviour gated on elapsed time or the absence of a human is a rule that only fires when nobody is looking.',
    why: 'Make the behaviour unconditional and visible, or remove it.',
  },
  'WL-AGT-011': {
    attack:
      'An agent that reads issues, pages or comments without being told they are untrusted will follow instructions written by whoever filed them.',
    why: 'State plainly that retrieved content is data and never instructions.',
  },
  'WL-AGT-014': {
    attack:
      'Hardening one agent file and not the others leaves the team believing a rule is enforced while half the tools ignore it.',
    why: 'Keep one source of truth and have the rest reference it.',
  },
  'WL-AGT-015': {
    attack:
      'A safety instruction present in one agent and missing in another is enforced only when that agent happens to be the one working.',
    why: 'The policy is only as strong as the least-configured agent with access.',
  },
  'WL-SEC-002': {
    attack:
      'An OpenAI key in the repository bills to your account and answers to anyone holding it. Usage looks legitimate because it is your key.',
    why: 'Revoke it first; moving it to the environment only stops the next copy.',
  },
  'WL-SEC-003': {
    attack:
      'An AWS access key id is half of a credential pair that usually sits beside its secret. Together they are your account.',
    why: 'Rotate through IAM and prefer short-lived role credentials over long-lived keys.',
  },
  'WL-SEC-004': {
    attack:
      'A Google API key committed in the open is scraped within hours and used until the quota runs out, on your bill.',
    why: 'Rotate it, then restrict the new key by referrer, IP or API.',
  },
  'WL-SEC-005': {
    attack:
      'A GitHub token grants whatever its scopes allow: reading private repositories, pushing to them, or acting as you in CI.',
    why: 'Revoke it, then reissue as a fine-grained token limited to the repositories it needs.',
  },
  'WL-SEC-006': {
    attack:
      'A Stripe secret key can move money. A live one in a repository is a financial incident, not a configuration mistake.',
    why: 'Roll it in the dashboard immediately and check recent activity.',
  },
  'WL-SEC-007': {
    attack:
      'A Slack token reads channel history and posts as the app, which is a convincing way to phish the rest of the team.',
    why: 'Revoke and reinstall the app; tokens cannot be scoped down after the fact.',
  },
  'WL-SEC-008': {
    attack:
      'A provider key bills to you and, for hosted inference, carries whatever data the model was sent.',
    why: 'Rotate it and keep provider keys in the environment, never in config the model itself reads.',
  },
  'WL-SEC-009': {
    attack:
      'A JWT is a bearer token: whoever holds it is the subject it names, until it expires. Many are issued with long lifetimes.',
    why: 'Invalidate the session and shorten the expiry; a committed token cannot be recalled.',
  },
  'WL-SEC-010': {
    attack:
      'A private key in a repository lets anyone sign or decrypt as its owner. There is no partial exposure.',
    why: 'Generate a new pair and revoke the old one everywhere it is trusted.',
  },
  'WL-SEC-012': {
    attack:
      'A credential assigned as a literal travels with the file into every fork, backup and CI log.',
    why: 'Reference an environment variable so the value stays outside version control.',
  },
  'WL-PRM-004': {
    attack:
      'A deny list with gaps is one nobody will re-read. The uncovered commands are the ones with no undo.',
    why: 'Cover the unrecoverable operations explicitly, even if the allow list makes them unlikely today.',
  },
  'WL-PRM-007': {
    attack:
      'A pre-approved force push or hard reset discards work without asking, and the reflog is the only way back.',
    why: 'Prefer --force-with-lease, and leave history rewriting to a human.',
  },
  'WL-PRM-008': {
    attack:
      'Unscoped installation runs lifecycle scripts from the registry with your privileges. Typosquatting works because the name is close enough.',
    why: 'Install dependencies yourself, or pin exactly which packages the agent may add.',
  },
  'WL-PRM-011': {
    attack:
      'A populated .env with no matching deny entry is one broad Read permission away from being in a model prompt.',
    why: 'Deny the path explicitly; relying on the allow list to stay narrow is a hope, not a control.',
  },
  'WL-HOK-008': {
    attack:
      'The clipboard routinely holds a password in transit. A hook that reads it captures whatever you copied last.',
    why: 'Automated hooks have no legitimate need for clipboard access.',
  },
  'WL-HOK-009': {
    attack:
      'Clearing shell history or system logs destroys the record of what else ran. That is anti-forensics, not maintenance.',
    why: 'Remove it and audit everything else this configuration does.',
  },
  'WL-HOK-010': {
    attack:
      'Installing packages on a hook means unreviewed third-party code executes every time the hook fires, on every machine.',
    why: 'Install during setup with a lockfile, where the diff is visible.',
  },
  'WL-HOK-012': {
    attack:
      'A session that begins by fetching remote content makes that endpoint a dependency of every session, before the user has done anything.',
    why: 'Fetch during an explicit setup step, and pin what you fetch.',
  },
  'WL-HOK-014': {
    attack:
      'Encoding has no functional purpose in a hook. It is there so a reader cannot tell what the command does.',
    why: 'Decode it, read it, and inline the plain command if it is legitimate.',
  },
  'WL-HOK-016': {
    attack:
      'A hook with no timeout can block on a slow network forever. The session hangs with no explanation and no way to tell why.',
    why: 'An explicit timeout turns a hang into an error message.',
  },
  'WL-MCP-004': {
    attack:
      'A browser server attached to your real profile inherits every session you are logged into, and page content becomes model input.',
    why: 'Use a disposable profile with no saved credentials.',
  },
  'WL-MCP-006': {
    attack:
      'An unpinned package resolves to whatever the registry serves at launch, so behaviour changes between runs with no local change.',
    why: 'Pin an exact version; a compromised release then needs your action to reach you.',
  },
  'WL-MCP-009': {
    attack:
      'Shell metacharacters in a launch line mean a second command runs under the name of a server definition, where nobody looks for one.',
    why: 'Launch one executable with plain arguments and keep orchestration in a reviewed script.',
  },
  'WL-MCP-011': {
    attack:
      'Binding to 0.0.0.0 exposes the tools to anything that can reach this machine, including other devices on a shared network.',
    why: 'Bind to 127.0.0.1 and tunnel if remote access is genuinely needed.',
  },
  'WL-MCP-013': {
    attack:
      'A networked server with no timeout can stall the session indefinitely and hold resources open behind it.',
    why: 'Set a timeout so a failure surfaces as an error rather than a hang.',
  },
  'WL-MCP-014': {
    attack:
      'A server inheriting the whole environment receives every variable in your shell, which in practice is every credential on the machine.',
    why: 'List the exact variables the server needs and pass only those.',
  },
  'WL-MCP-015': {
    attack:
      'Each server is third-party code inside the trust boundary, and their tool descriptions all compete for the model attention budget.',
    why: 'Enable what a project actually needs and keep the rest in a template you opt into.',
  },
  'WL-AGT-004': {
    attack:
      'An HTML comment disappears from rendered markdown but stays in the raw file the model is given, so a directive can hide in plain sight.',
    why: 'Real instructions belong in the visible body; anything meant only for the model should not exist.',
  },
  'WL-AGT-005': {
    attack:
      'A long encoded blob in a prompt file cannot be read by a reviewer, but a model asked to decode it can act on what it contains.',
    why: 'Decode it and inline the plain text, or delete it.',
  },
  'WL-AGT-012': {
    attack:
      'Past a certain length the safety-relevant lines compete with everything else, and compliance with any one of them becomes unreliable.',
    why: 'Keep the prompt to rules that must hold every turn and link the reference material.',
  },
  'WL-AGT-013': {
    attack:
      'An agent with no description cannot be reviewed for scope, so nobody can judge whether delegating to it is reasonable.',
    why: 'One line stating the role and when to use it makes the rest of the config auditable.',
  },
};
