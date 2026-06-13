import Link from "next/link";

import { Wordmark } from "@/shared/components/wordmark";

/**
 * Public marketing landing (go-live B). Lives at "/" (made public in proxy.ts).
 * Self-contained — outside the (main) app shell, so no sidebar.
 */
const MarketingPage = () => {
  return (
    <div className="min-h-screen bg-white text-neutral-700">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Wordmark iconSize={36} textClass="text-xl" />
        <div className="flex items-center gap-x-3">
          <Link
            href="/sign-in"
            className="text-sm font-bold text-neutral-600 hover:underline"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-xl border-2 border-b-4 border-green-600 bg-green-500 px-4 py-2 text-sm font-bold text-white active:border-b-2"
          >
            Start free trial
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-16 text-center sm:py-24">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight text-neutral-800 sm:text-5xl">
            Train your crew in the field — in their language, in minutes.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Duolingo-style safety and skills training built for landscaping
            crews. Assign required courses, turn a job-site photo into a lesson,
            and prove your crew is trained.
          </p>
          <div className="mt-8 flex items-center justify-center gap-x-3">
            <Link
              href="/sign-up"
              className="rounded-xl border-2 border-b-4 border-green-600 bg-green-500 px-6 py-3 text-base font-bold text-white active:border-b-2"
            >
              Start your 14-day free trial
            </Link>
            <Link
              href="/sign-in"
              className="rounded-xl border-2 px-6 py-3 text-base font-bold text-neutral-600 hover:bg-slate-50"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            No credit card required to start.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 pb-16 sm:grid-cols-3">
          {[
            {
              title: "Assign required training",
              body: "Assign courses to a crew or person with a due date. See who's done, who's overdue.",
            },
            {
              title: "Photo → lesson in 60 seconds",
              body: "Snap a job-site mistake. AI turns it into a short lesson you can assign the same day.",
            },
            {
              title: "Bilingual, gamified",
              body: "English and Spanish, streaks and points — training crews actually finish.",
            },
          ].map((feature) => (
            <div key={feature.title} className="rounded-2xl border-2 p-6">
              <h3 className="font-bold text-neutral-800">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </section>

        <section className="pb-24">
          <div className="mx-auto max-w-md rounded-2xl border-2 p-8 text-center">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Simple pricing
            </h2>
            <div className="mt-3 text-5xl font-extrabold text-neutral-800">
              $99
              <span className="text-lg font-bold text-muted-foreground">
                /month
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Unlimited crew. All features. 14-day free trial, cancel anytime.
            </p>
            <Link
              href="/sign-up"
              className="mt-6 inline-block rounded-xl border-2 border-b-4 border-green-600 bg-green-500 px-6 py-3 text-base font-bold text-white active:border-b-2"
            >
              Start free trial
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t-2">
        <div className="mx-auto max-w-5xl px-6 py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} SonarCoach
        </div>
      </footer>
    </div>
  );
};

export default MarketingPage;
