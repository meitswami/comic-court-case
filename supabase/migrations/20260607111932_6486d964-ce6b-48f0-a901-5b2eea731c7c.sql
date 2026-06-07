
CREATE OR REPLACE FUNCTION public.is_session_participant(_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.court_participants cp
    WHERE cp.session_id = _session_id AND cp.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.court_sessions cs
    JOIN public.cases c ON c.id = cs.case_id
    WHERE cs.id = _session_id AND c.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_court_participant(_participant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.court_participants cp
    WHERE cp.id = _participant_id AND cp.user_id = auth.uid()
  );
$$;

-- ai_usage_logs
DROP POLICY IF EXISTS "Users can view own AI usage logs" ON public.ai_usage_logs;
CREATE POLICY "Users can view own AI usage logs" ON public.ai_usage_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- court_hand_raises
DROP POLICY IF EXISTS "Anyone can view hand raises" ON public.court_hand_raises;
DROP POLICY IF EXISTS "Participants can raise hand" ON public.court_hand_raises;
DROP POLICY IF EXISTS "Admin can update hand raises" ON public.court_hand_raises;
CREATE POLICY "Participants view hand raises" ON public.court_hand_raises
  FOR SELECT TO authenticated USING (public.is_session_participant(session_id) OR public.is_admin());
CREATE POLICY "Participants insert hand raises" ON public.court_hand_raises
  FOR INSERT TO authenticated WITH CHECK (public.is_session_participant(session_id) AND public.owns_court_participant(participant_id));
CREATE POLICY "Admin updates hand raises" ON public.court_hand_raises
  FOR UPDATE TO authenticated USING (public.is_admin() OR public.is_session_participant(session_id));

-- court_evidence_submissions
DROP POLICY IF EXISTS "Anyone can view evidence" ON public.court_evidence_submissions;
DROP POLICY IF EXISTS "Participants can submit evidence" ON public.court_evidence_submissions;
DROP POLICY IF EXISTS "Admin can update evidence" ON public.court_evidence_submissions;
CREATE POLICY "Participants view evidence" ON public.court_evidence_submissions
  FOR SELECT TO authenticated USING (public.is_session_participant(session_id) OR public.is_admin());
CREATE POLICY "Participants submit evidence" ON public.court_evidence_submissions
  FOR INSERT TO authenticated WITH CHECK (public.is_session_participant(session_id) AND public.owns_court_participant(participant_id));
CREATE POLICY "Admin updates evidence" ON public.court_evidence_submissions
  FOR UPDATE TO authenticated USING (public.is_admin());

-- court_date_requests
DROP POLICY IF EXISTS "Anyone can view date requests" ON public.court_date_requests;
DROP POLICY IF EXISTS "Participants can request dates" ON public.court_date_requests;
DROP POLICY IF EXISTS "Judge can update requests" ON public.court_date_requests;
CREATE POLICY "Participants view date requests" ON public.court_date_requests
  FOR SELECT TO authenticated USING (public.is_session_participant(session_id) OR public.is_admin());
CREATE POLICY "Participants insert date requests" ON public.court_date_requests
  FOR INSERT TO authenticated WITH CHECK (public.is_session_participant(session_id) AND requested_by = auth.uid());
CREATE POLICY "Admin updates date requests" ON public.court_date_requests
  FOR UPDATE TO authenticated USING (public.is_admin());

-- court_witness_requests
DROP POLICY IF EXISTS "Anyone can view witness requests" ON public.court_witness_requests;
DROP POLICY IF EXISTS "Participants can request witnesses" ON public.court_witness_requests;
DROP POLICY IF EXISTS "Judge can update witness requests" ON public.court_witness_requests;
CREATE POLICY "Participants view witness requests" ON public.court_witness_requests
  FOR SELECT TO authenticated USING (public.is_session_participant(session_id) OR public.is_admin());
CREATE POLICY "Participants insert witness requests" ON public.court_witness_requests
  FOR INSERT TO authenticated WITH CHECK (public.is_session_participant(session_id) AND requested_by = auth.uid());
CREATE POLICY "Admin updates witness requests" ON public.court_witness_requests
  FOR UPDATE TO authenticated USING (public.is_admin());

-- court_participants
DROP POLICY IF EXISTS "Participants can view other participants" ON public.court_participants;
CREATE POLICY "Fellow participants view participants" ON public.court_participants
  FOR SELECT TO authenticated USING (public.is_session_participant(session_id) OR public.is_admin());

-- court_transcripts
DROP POLICY IF EXISTS "Anyone can view transcripts of active sessions" ON public.court_transcripts;
DROP POLICY IF EXISTS "Participants can add transcripts" ON public.court_transcripts;
CREATE POLICY "Participants view transcripts" ON public.court_transcripts
  FOR SELECT TO authenticated USING (public.is_session_participant(session_id) OR public.is_admin());
CREATE POLICY "Participants insert transcripts" ON public.court_transcripts
  FOR INSERT TO authenticated WITH CHECK (public.is_session_participant(session_id));

-- identity_verifications
DROP POLICY IF EXISTS "Users can create verifications" ON public.identity_verifications;
CREATE POLICY "Authenticated users create own verifications" ON public.identity_verifications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- notifications
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
CREATE POLICY "Admins create notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
