/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GovernanceSecurityView } from './components/GovernanceSecurityView';
import { Layout } from './components/Layout';
import { Module1PreprocessingView } from './components/Module1PreprocessingView';
import { Module2DistributionView } from './components/Module2DistributionView';
import { Module3TrendsUncertaintyView } from './components/Module3TrendsUncertaintyView';
import { OnboardingModal } from './components/OnboardingModal';
import { OverviewView } from './components/OverviewView';
import { AuthProvider } from './context/AuthContext';
import { ClaimsDataProvider } from './context/ClaimsDataContext';
import { NavSection } from './types/claims';

function PlatformWorkspace() {
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <Layout
      activeSection={activeSection}
      onNavigate={setActiveSection}
      onOpenGuide={() => setGuideOpen(true)}
    >
      {activeSection === 'overview' && (
        <OverviewView
          onNavigate={setActiveSection}
          onOpenGuide={() => setGuideOpen(true)}
        />
      )}
      {activeSection === 'module1' && <Module1PreprocessingView />}
      {activeSection === 'module2' && <Module2DistributionView />}
      {activeSection === 'module3' && <Module3TrendsUncertaintyView />}
      {activeSection === 'governance' && <GovernanceSecurityView />}

      <OnboardingModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onNavigate={setActiveSection}
      />
    </Layout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ClaimsDataProvider>
          <PlatformWorkspace />
        </ClaimsDataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
