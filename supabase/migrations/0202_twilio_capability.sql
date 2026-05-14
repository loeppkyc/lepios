-- Register net.outbound.twilio capability
INSERT INTO public.capabilities (name, category, description, enforcement, requires_user_approval)
VALUES (
  'net.outbound.twilio',
  'net',
  'Twilio REST API — outbound SMS and Voice',
  'enforce',
  false
) ON CONFLICT (name) DO NOTHING;

-- Grant to harness agent
INSERT INTO public.agent_capabilities (agent_id, capability_name, enforcement, granted_by, description)
VALUES (
  'harness',
  'net.outbound.twilio',
  'enforce',
  'colin',
  'harness — send alerts and command replies via SMS'
) ON CONFLICT (agent_id, capability_name) DO NOTHING;

-- Grant to coordinator agent
INSERT INTO public.agent_capabilities (agent_id, capability_name, enforcement, granted_by, description)
VALUES (
  'coordinator',
  'net.outbound.twilio',
  'enforce',
  'colin',
  'coordinator — send escalations via SMS fallback'
) ON CONFLICT (agent_id, capability_name) DO NOTHING;

GRANT INSERT, UPDATE, DELETE ON public.capabilities TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.agent_capabilities TO service_role;
