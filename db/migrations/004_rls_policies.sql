-- TokenFin RLS Policies Migration
-- Applied: 2026-06-15

-- organizations: allow authenticated users to create and access their orgs
CREATE POLICY "organizations_insert" ON organizations
  FOR INSERT WITH CHECK (
    auth.uid() = owner_id OR
    auth.uid() IS NOT NULL  -- allow creation, owner_id is set in app
  );

CREATE POLICY "organizations_select" ON organizations
  FOR SELECT USING (
    auth.uid() = owner_id OR
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = organizations.id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "organizations_update" ON organizations
  FOR UPDATE USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- members: allow org members to view and add members
CREATE POLICY "members_insert" ON members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations WHERE organizations.id = members.org_id AND organizations.owner_id = auth.uid()
    ) OR
    auth.uid() = invited_by
  );

CREATE POLICY "members_select" ON members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members AS m WHERE m.org_id = members.org_id AND m.user_id = auth.uid()
    )
  );

-- projects: allow org members to view and create projects
CREATE POLICY "projects_select" ON projects
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "projects_insert" ON projects
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = projects.org_id AND members.user_id = auth.uid()
    )
  );

-- api_keys: allow org members to view and create keys
CREATE POLICY "api_keys_select" ON api_keys
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "api_keys_insert" ON api_keys
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = api_keys.org_id AND members.user_id = auth.uid() AND members.role IN ('owner', 'admin')
    )
  );

-- usage_events: allow service role to write, members to read
CREATE POLICY "usage_events_select" ON usage_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = usage_events.org_id AND members.user_id = auth.uid()
    )
  );

-- limits: allow org admins to manage limits
CREATE POLICY "limits_select" ON limits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "limits_insert" ON limits
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = limits.org_id AND members.user_id = auth.uid() AND members.role IN ('owner', 'admin')
    )
  );

-- invitations: allow org owners to send invites
CREATE POLICY "invitations_select" ON invitations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = invitations.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "invitations_insert" ON invitations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations WHERE organizations.id = invitations.org_id AND organizations.owner_id = auth.uid()
    )
  );

-- notifications: allow users to view their own notifications
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

-- alert_rules: allow org members to view, admins to create
CREATE POLICY "alert_rules_select" ON alert_rules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = alert_rules.org_id AND members.user_id = auth.uid()
    )
  );

-- blocks: allow org admins to view
CREATE POLICY "blocks_select" ON blocks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = blocks.org_id AND members.user_id = auth.uid() AND members.role IN ('owner', 'admin')
    )
  );

-- budget_requests: allow members to view their org's requests
CREATE POLICY "budget_requests_select" ON budget_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = budget_requests.org_id AND members.user_id = auth.uid()
    )
  );

CREATE POLICY "budget_requests_insert" ON budget_requests
  FOR INSERT WITH CHECK (
    auth.uid() = requested_by AND
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = budget_requests.org_id AND members.user_id = auth.uid()
    )
  );

-- usage_agg: allow members to view aggregated usage
CREATE POLICY "usage_agg_select" ON usage_agg
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.org_id = usage_agg.org_id AND members.user_id = auth.uid()
    )
  );
