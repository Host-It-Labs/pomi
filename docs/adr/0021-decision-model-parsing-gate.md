# Decision-model parsing gate

Status: Accepted

AI Task capture asks a decision model (Mercury Decide, through OpenRouter's Decisions API) whether short single-line input is one plain Task, and which Intention it belongs to, before calling the text model. When both answers are confident, Pomi creates the Task with its local parsing rules and the chosen Intention, without a text-model call. Every other outcome, including low confidence, invalid answers, timeouts, and provider errors, sends the input to the text model unchanged.

Decision models only choose among supplied options; they cannot write titles, resolve dates, or split input into several Tasks, so they gate the text model instead of replacing it. The thresholds favour the text model because an unnecessary call costs a fraction of a cent, while a wrong local parse silently loses a date, recurrence, or second Task.

Mercury Decide was chosen over Jev, d1, and Span-01 after a comparison on representative English, French, German, and Spanish input: it matched Jev's accuracy at about a fifth of the cost. Its probabilities are close to binary, so the confidence thresholds act as a safety net rather than a fine-grained control.
