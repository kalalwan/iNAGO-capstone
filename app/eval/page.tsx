'use client';

import { useState } from 'react';
import { scenarios, buildProfileFromEvalUser, EvalScenario } from '@/lib/eval-scenarios';
import { RESTAURANTS } from '@/lib/data';
import { selectBestRestaurant } from '@/lib/fairness';
import {
  StructuredUserProfile,
  FairnessResult,
  ScoredRestaurant,
} from '@/lib/types';
import { Scale, CheckCircle, XCircle, AlertTriangle, ArrowLeft, Play, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface ScenarioResult {
  scenario: EvalScenario;
  profiles: StructuredUserProfile[];
  fairnessResult: FairnessResult | null;
  hardConstraintViolations: number;
  passed: boolean;
  error?: string;
}

export default function EvalPage() {
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedResult, setSelectedResult] = useState<ScenarioResult | null>(null);

  const runAllScenarios = () => {
    setRunning(true);
    setSelectedResult(null);

    const newResults: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      try {
        // Build profiles from scenario
        const profiles = scenario.users.map((u, i) => buildProfileFromEvalUser(u, i));

        // Score all restaurants for this group
        const scored: ScoredRestaurant[] = RESTAURANTS.map(r => ({
          ...r,
          score: 0.5, // Base score — no embedding in eval
        }));

        // Run fairness analysis
        const fairnessResult = selectBestRestaurant(scored, profiles);

        // Count hard constraint violations
        let hardViolations = 0;
        for (const sat of fairnessResult.userSatisfaction) {
          if (!sat.satisfied) {
            hardViolations++;
          }
        }

        // Pass criteria:
        // 1. No hard constraint violations (or no feasible option found, which is acceptable)
        // 2. Nash welfare > 0 (unless constraints conflict)
        const allHardMet = hardViolations === 0;
        const nashAboveZero = fairnessResult.metrics.nash > 0;
        const passed = allHardMet && (nashAboveZero || profiles.length <= 1);

        newResults.push({
          scenario,
          profiles,
          fairnessResult,
          hardConstraintViolations: hardViolations,
          passed,
        });
      } catch (e) {
        newResults.push({
          scenario,
          profiles: [],
          fairnessResult: null,
          hardConstraintViolations: 0,
          passed: false,
          error: String(e),
        });
      }
    }

    setResults(newResults);
    setRunning(false);
  };

  // Summary stats
  const passCount = results.filter(r => r.passed).length;
  const avgNash = results.length > 0
    ? results.reduce((sum, r) => sum + (r.fairnessResult?.metrics.nash || 0), 0) / results.length
    : 0;
  const avgGini = results.length > 0
    ? results.reduce((sum, r) => sum + (r.fairnessResult?.metrics.gini || 0), 0) / results.length
    : 0;
  const avgMinSat = results.length > 0
    ? results.reduce((sum, r) => sum + (r.fairnessResult?.metrics.egalitarian || 0), 0) / results.length
    : 0;

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link href="/" className="text-gray-400 hover:text-gray-600">
                <ArrowLeft size={20} />
              </Link>
              <h1 className="text-3xl font-bold text-gray-800">Evaluation Dashboard</h1>
            </div>
            <p className="text-gray-500 ml-8">
              Synthetic scenario testing for the iNAGO Eats fairness system
            </p>
          </div>
          <button
            onClick={runAllScenarios}
            disabled={running}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
          >
            <Play size={18} />
            {running ? 'Running...' : 'Run All Scenarios'}
          </button>
        </div>

        {/* Summary Stats */}
        {results.length > 0 && (
          <div className="grid grid-cols-5 gap-4 mb-8">
            <div className="bg-white rounded-xl p-4 shadow-sm border">
              <div className="text-sm text-gray-500">Pass Rate</div>
              <div className={cn(
                "text-3xl font-bold",
                passCount === results.length ? "text-green-600" : "text-yellow-600"
              )}>
                {passCount}/{results.length}
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border">
              <div className="text-sm text-gray-500">Avg Nash Welfare</div>
              <div className="text-3xl font-bold text-indigo-600">
                {(avgNash * 100).toFixed(0)}%
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border">
              <div className="text-sm text-gray-500">Avg Gini</div>
              <div className={cn(
                "text-3xl font-bold",
                avgGini < 0.2 ? "text-green-600" :
                avgGini < 0.4 ? "text-yellow-600" : "text-red-600"
              )}>
                {(avgGini * 100).toFixed(0)}%
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border">
              <div className="text-sm text-gray-500">Avg Min Satisfaction</div>
              <div className="text-3xl font-bold text-gray-700">
                {(avgMinSat * 100).toFixed(0)}%
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border">
              <div className="text-sm text-gray-500">Constraint Violations</div>
              <div className={cn(
                "text-3xl font-bold",
                results.every(r => r.hardConstraintViolations === 0) ? "text-green-600" : "text-red-600"
              )}>
                {results.reduce((sum, r) => sum + r.hardConstraintViolations, 0)}
              </div>
            </div>
          </div>
        )}

        {/* Scenario Results */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
            <BarChart3 size={20} />
            Scenario Results ({scenarios.length} scenarios)
          </h2>

          {results.length === 0 && (
            <div className="text-center text-gray-400 py-20 bg-white rounded-xl border">
              Click &ldquo;Run All Scenarios&rdquo; to begin evaluation
            </div>
          )}

          {results.map((result, idx) => (
            <div
              key={idx}
              className={cn(
                "bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow",
                selectedResult === result && "ring-2 ring-indigo-500"
              )}
              onClick={() => setSelectedResult(selectedResult === result ? null : result)}
            >
              {/* Header Row */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  {result.passed ? (
                    <CheckCircle className="text-green-500" size={20} />
                  ) : (
                    <XCircle className="text-red-500" size={20} />
                  )}
                  <div>
                    <div className="font-semibold text-gray-800">
                      {idx + 1}. {result.scenario.name}
                    </div>
                    <div className="text-xs text-gray-400">{result.scenario.description}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Users</div>
                    <div className="font-mono">{result.scenario.users.length}</div>
                  </div>
                  {result.fairnessResult && (
                    <>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Nash</div>
                        <div className="font-mono text-indigo-600">
                          {(result.fairnessResult.metrics.nash * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Gini</div>
                        <div className={cn(
                          "font-mono",
                          result.fairnessResult.metrics.gini < 0.3 ? "text-green-600" : "text-yellow-600"
                        )}>
                          {(result.fairnessResult.metrics.gini * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Min Sat</div>
                        <div className="font-mono">
                          {(result.fairnessResult.metrics.egalitarian * 100).toFixed(0)}%
                        </div>
                      </div>
                    </>
                  )}
                  <div className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold",
                    result.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  )}>
                    {result.passed ? 'PASS' : 'FAIL'}
                  </div>
                </div>
              </div>

              {/* Expanded Detail */}
              {selectedResult === result && result.fairnessResult && (
                <div className="border-t bg-gray-50 p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Expected Behavior */}
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Expected Behavior</div>
                      <p className="text-sm text-gray-600">{result.scenario.expectedBehavior}</p>
                    </div>

                    {/* Selected Restaurant */}
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Selected Restaurant</div>
                      <div className="bg-white rounded-lg p-3 border">
                        <div className="font-bold">{result.fairnessResult.restaurant.name}</div>
                        <div className="text-sm text-gray-500">{result.fairnessResult.restaurant.cuisine} {result.fairnessResult.restaurant.price}</div>
                        <div className="text-xs text-gray-400">{result.fairnessResult.restaurant.address}</div>
                        {result.fairnessResult.isParetoEfficient && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full mt-1 inline-block">
                            Pareto Efficient
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Per-User Satisfaction */}
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Per-User Satisfaction</div>
                    <div className="space-y-2">
                      {result.fairnessResult.userSatisfaction.map(u => (
                        <div key={u.userId} className="flex items-center gap-3">
                          <span className="text-sm w-28 truncate font-medium">{u.userName}</span>
                          <div className="flex-1 h-3 bg-gray-200 rounded-full">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                u.satisfied
                                  ? u.score > 0.7 ? "bg-green-500" : u.score > 0.4 ? "bg-yellow-500" : "bg-orange-500"
                                  : "bg-red-500"
                              )}
                              style={{ width: `${u.score * 100}%` }}
                            />
                          </div>
                          <span className={cn(
                            "text-sm font-mono w-12 text-right",
                            u.satisfied ? "text-gray-600" : "text-red-600 font-bold"
                          )}>
                            {(u.score * 100).toFixed(0)}%
                          </span>
                          {!u.satisfied && (
                            <span className="text-xs text-red-500 flex items-center gap-1">
                              <AlertTriangle size={12} />
                              Constraint violated
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Constraint Audit */}
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Constraint Violation Audit</div>
                    <div className={cn(
                      "flex items-center gap-2 p-3 rounded-lg",
                      result.hardConstraintViolations === 0
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    )}>
                      {result.hardConstraintViolations === 0 ? (
                        <><CheckCircle size={16} /> Zero hard constraint violations</>
                      ) : (
                        <><XCircle size={16} /> {result.hardConstraintViolations} hard constraint violation(s)</>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Fairness Distribution Charts (simple CSS bars) */}
        {results.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2 mb-4">
              <Scale size={20} />
              Fairness Metric Distributions
            </h2>

            <div className="grid grid-cols-3 gap-6">
              {/* Nash Welfare Distribution */}
              <div className="bg-white rounded-xl border p-4 shadow-sm">
                <div className="text-sm font-semibold text-gray-600 mb-3">Nash Welfare by Scenario</div>
                <div className="space-y-2">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] w-14 truncate text-gray-400">{i + 1}.</span>
                      <div className="flex-1 h-4 bg-gray-100 rounded-full">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${(r.fairnessResult?.metrics.nash || 0) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-10 text-right">
                        {((r.fairnessResult?.metrics.nash || 0) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Gini Coefficient Distribution */}
              <div className="bg-white rounded-xl border p-4 shadow-sm">
                <div className="text-sm font-semibold text-gray-600 mb-3">Gini Coefficient by Scenario</div>
                <div className="space-y-2">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] w-14 truncate text-gray-400">{i + 1}.</span>
                      <div className="flex-1 h-4 bg-gray-100 rounded-full">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            (r.fairnessResult?.metrics.gini || 0) < 0.2 ? "bg-green-500" :
                            (r.fairnessResult?.metrics.gini || 0) < 0.4 ? "bg-yellow-500" : "bg-red-500"
                          )}
                          style={{ width: `${(r.fairnessResult?.metrics.gini || 0) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-10 text-right">
                        {((r.fairnessResult?.metrics.gini || 0) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Minimum Satisfaction Distribution */}
              <div className="bg-white rounded-xl border p-4 shadow-sm">
                <div className="text-sm font-semibold text-gray-600 mb-3">Min Satisfaction by Scenario</div>
                <div className="space-y-2">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] w-14 truncate text-gray-400">{i + 1}.</span>
                      <div className="flex-1 h-4 bg-gray-100 rounded-full">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            (r.fairnessResult?.metrics.egalitarian || 0) > 0.5 ? "bg-green-500" :
                            (r.fairnessResult?.metrics.egalitarian || 0) > 0.3 ? "bg-yellow-500" : "bg-orange-500"
                          )}
                          style={{ width: `${(r.fairnessResult?.metrics.egalitarian || 0) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-10 text-right">
                        {((r.fairnessResult?.metrics.egalitarian || 0) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
