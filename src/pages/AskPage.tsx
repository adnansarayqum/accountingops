import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, Search } from 'lucide-react';
import { PageHeader } from '../ui/components/PageHeader';
import { Card, CardBody } from '../ui/components/Card';
import { Input } from '../ui/components/Form';
import { Button } from '../ui/components/Button';
import { useData, useDerived, useToday } from '../application/selectors';
import { EXAMPLE_QUESTIONS, routeQuestion } from '../application/assistant/router';
import { cn } from '../ui/cn';

export function AskPage() {
  const data = useData();
  const derived = useDerived();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [input, setInput] = useState(initial);
  const [question, setQuestion] = useState(initial);
  useEffect(() => {
    setInput(initial);
    setQuestion(initial);
  }, [initial]);

  const result = useMemo(() => (question.trim() ? routeQuestion({ data, derived, today }, question) : null), [question, data, derived, today]);

  const ask = (q: string) => {
    setQuestion(q);
    setInput(q);
    setParams(q ? { q } : {}, { replace: true });
  };

  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title="Ask the practice" description="Deterministic answers from your practice data through scoped tools. A language model can be introduced behind the same tools later — the database is never handed to it wholesale." />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input.trim());
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Which clients still need chasing this month?" className="pl-9 h-11 text-[15px]" aria-label="Question" autoFocus data-testid="ask-input" />
        </div>
        <Button type="submit" size="lg" icon={<Sparkles />}>
          Ask
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button key={q} type="button" onClick={() => ask(q)} className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', question === q ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary-700')}>
            {q}
          </button>
        ))}
      </div>

      {result && (
        <Card className="mt-5 animate-in" data-testid="ask-result">
          <CardBody className="pt-5">
            <p className="text-[15px] font-semibold text-slate-900">{result.answer}</p>
            {result.rows.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                {result.rows.map((r, i) => (
                  <li key={`${r.title}-${i}`}>
                    {r.href ? (
                      <Link to={r.href} className="flex items-start gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-md">
                        <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', r.tone === 'red' ? 'bg-red-500' : r.tone === 'amber' ? 'bg-amber-500' : r.tone === 'green' ? 'bg-emerald-500' : 'bg-slate-300')} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-900">{r.title}</span>
                          {r.subtitle && <span className="block text-xs text-slate-500">{r.subtitle}</span>}
                        </span>
                      </Link>
                    ) : (
                      <div className="py-2.5 text-sm text-slate-800">{r.title}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-slate-400">Answered by tool: {result.tool}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
