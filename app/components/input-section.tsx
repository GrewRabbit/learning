// app/components/input-section.tsx
// 输入区父组件（Client Component）：协调 problem 与 standardAnswer 两个受控状态
// 必要性：app/page.tsx 为 Server Component 无法持有状态，
// 而「生成解答」按钮需读取 standardAnswer 决定 mode=normal|deep（FR-005）

'use client';

import * as React from 'react';

import { ProblemInput } from '@/app/components/problem-input';
import { StandardAnswerInput } from '@/app/components/standard-answer-input';

/**
 * 首页输入区组合组件
 * - 持有 problemText 与 standardAnswer 两个状态
 * - 将状态与回调下传给 ProblemInput 与 StandardAnswerInput
 */
export function InputSection(): React.JSX.Element {
  const [problemText, setProblemText] = React.useState('');
  const [standardAnswer, setStandardAnswer] = React.useState('');

  return (
    <div className="space-y-4">
      <ProblemInput
        problemText={problemText}
        onProblemTextChange={setProblemText}
        standardAnswer={standardAnswer}
      />
      <StandardAnswerInput
        value={standardAnswer}
        onChange={setStandardAnswer}
      />
    </div>
  );
}
