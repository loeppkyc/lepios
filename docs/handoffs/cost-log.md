# Cost Log

Format: {timestamp} coordinator sprint={N} chunk={id} phase={1-6} tokens_in={N} tokens_out={N} escalated={bool} auto_proceeded={bool}

---

2026-05-15T12:12:00Z coordinator sprint=sprint-5 chunk=ingest-health-notes phase=0-2 tokens_in=~18000 tokens_out=~4000 escalated=true auto_proceeded=false
2026-05-10T04:20:00Z coordinator sprint=T003 chunk=T003-study phase=1a tokens_in=~18000 tokens_out=~6000 escalated=true auto_proceeded=false
  reason: 4 open design questions (receipt_lines table shape, reconciliation target, camera OCR completeness, extraction method)
  twin_blocked: true (sandbox cannot reach lepios-one.vercel.app)
  pre_condition: gmail-scanner grounding required before T003-A builds
2026-05-10T04:00:00Z coordinator sprint=leverage-targets chunk=T-005 phase=1a-1b tokens_in=~22000 tokens_out=~8000 escalated=true auto_proceeded=false
2026-05-10T03:55:00Z coordinator sprint=standalone chunk=watchdog-monitor phase=check-before-build tokens_in=~12000 tokens_out=~4000 escalated=true auto_proceeded=false
2026-05-10T03:34:00Z coordinator sprint=tooling chunk=diagnosis_cron_audit phase=investigation tokens_in=~14000 tokens_out=~3000 escalated=false auto_proceeded=true task_id=8985a936-0232-41b3-b2cc-f85813bb1840 verdict=hallucinated
2026-05-09T14:05:00Z coordinator sprint=ad-hoc chunk=corpus-gap-seborrheic phase=2 tokens_in=~18000 tokens_out=~4000 escalated=true auto_proceeded=false
2026-04-27T00:00:00Z coordinator sprint=5 chunk=H3 phase=1a-1d tokens_in=~18000 tokens_out=~6000 escalated=true auto_proceeded=false

2026-04-22T13:55:00Z coordinator sprint=harness-e2e chunk=v0-test phase=1-3 tokens_in=~18000 tokens_out=~4000 escalated=true auto_proceeded=false
2026-04-23T20:00:00Z coordinator sprint=4 chunk=D phase=1a-1d+2+3 tokens_in=~32000 tokens_out=~8000 escalated=false auto_proceeded=false colin_direct_ratification=true builder_delegated=true
2026-04-25T22:00:00Z coordinator sprint=5 chunk=coordinator-env phase=1a-1d+2+3 tokens_in=~22000 tokens_out=~6000 escalated=false auto_proceeded=false colin_direct_ratification=true builder_delegated=true
2026-04-25T23:21:00Z coordinator sprint=5 chunk=stall-alert phase=1a-1d+2+3 tokens_in=~28000 tokens_out=~7000 escalated=false auto_proceeded=false colin_direct_ratification=true builder_delegated=true
2026-04-26T01:16:00Z coordinator sprint=5 chunk=notification-drain-dedup phase=1a-1d+3 tokens_in=~25000 tokens_out=~5000 escalated=false auto_proceeded=false colin_direct_ratification=true builder_delegated=true
2026-04-27T00:40:00Z coordinator sprint=5 chunk=h1-drain-fix phase=1a+2 tokens_in=~38000 tokens_out=~9000 escalated=true auto_proceeded=false task_id=8a9dcb62
2026-05-08T00:00:00Z coordinator sprint=5 chunk=subdir-detection phase=2 tokens_in=~15000 tokens_out=~4000 escalated=true auto_proceeded=false
2026-05-09T03:05:00Z coordinator sprint=5 chunk=subdir-detection phase=3+4 tokens_in=~45000 tokens_out=~12000 escalated=false auto_proceeded=false task_id=3dcf9706 run_id=5cb5f13f colin_answers_applied=true build_complete=true tests=11/11 status=awaiting_grounding
2026-05-09T03:40:00Z coordinator sprint=5 chunk=scanner-subdir-fix phase=5+2+3 tokens_in=~8000 tokens_out=~3000 escalated=false auto_proceeded=true
2026-05-10T03:30:00Z coordinator sprint=5 chunk=ollama-tunnel-url-harness-config phase=2-3 tokens_in=~35000 tokens_out=~6000 escalated=false auto_proceeded=true
2026-05-15T14:00:00Z coordinator sprint=5 chunk=ollama-preresearch phase=0+2 tokens_in=~40000 tokens_out=~10000 escalated=true auto_proceeded=false task_id=574ed32c run_id=manual-20260515-002
  escalation_reasons: Q1 (Phase 1a skip vs supplementary — Colin decides), Q2 (coordinator.md edit requires explicit approval)
  acceptance_doc: docs/sprint-5/ollama-preresearch-daytime-tick-acceptance.md
2026-05-15T20:25:00Z coordinator sprint=5 chunk=f18-ceiling phase=0-4+5 tokens_in=~95000 tokens_out=~18000 escalated=false auto_proceeded=true task_id=e1d3c848 run_id=daee50b5 colin_direct_ratification=true grounding_result=pass pr=269 migration=0206
