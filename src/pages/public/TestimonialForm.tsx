import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check } from "lucide-react";
import { invokeEdgeFunction } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Public client feedback form (Module 7). Reached via the shareable link
 * /t/{token} — no login required. All reads/writes go through the public
 * testimonial-form Edge Function, which validates the opaque token
 * server-side.
 */
export default function TestimonialForm() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<"loading" | "ready" | "submitting" | "done" | "error">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [clientName, setClientName] = useState("");
  const [answers, setAnswers] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      if (!token) {
        setPhase("error");
        setError("Missing form link.");
        return;
      }
      try {
        const result = await invokeEdgeFunction<{ title: string; questions: string[] }>(
          "testimonial-form",
          { action: "get", token }
        );
        setTitle(result.title);
        setQuestions(result.questions);
        setAnswers(result.questions.map(() => ""));
        setPhase("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "This form isn't available.");
        setPhase("error");
      }
    }
    void load();
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!answers.some((a) => a.trim().length > 0)) {
      setError("Answer at least one question.");
      return;
    }
    setPhase("submitting");
    try {
      await invokeEdgeFunction("testimonial-form", {
        action: "submit",
        token,
        client_name: clientName.trim(),
        answers: questions.map((q, i) => ({ question: q, answer: answers[i] })),
      });
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Try again.");
      setPhase("ready");
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-secondary/40 px-4 py-10">
      <Card className="w-full max-w-xl">
        {phase === "loading" && (
          <CardContent className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        )}

        {phase === "error" && (
          <CardContent className="py-12 text-center">
            <p className="font-medium">This form isn't available</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </CardContent>
        )}

        {phase === "done" && (
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-6 w-6" />
            </div>
            <p className="text-lg font-semibold">Thank you!</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your feedback was sent. It means a lot — seriously.
            </p>
          </CardContent>
        )}

        {(phase === "ready" || phase === "submitting") && (
          <>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                A few quick questions — answer whichever ones you'd like.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="client-name">Your name (optional)</Label>
                  <Input
                    id="client-name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="First name is fine"
                  />
                </div>
                {questions.map((q, i) => (
                  <div key={i} className="space-y-1.5">
                    <Label htmlFor={`q-${i}`}>{q}</Label>
                    <Textarea
                      id={`q-${i}`}
                      rows={3}
                      value={answers[i] ?? ""}
                      onChange={(e) =>
                        setAnswers((arr) => arr.map((a, idx) => (idx === i ? e.target.value : a)))
                      }
                    />
                  </div>
                ))}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={phase === "submitting"}>
                  {phase === "submitting" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {phase === "submitting" ? "Sending…" : "Send feedback"}
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
