import type { ImportReport } from './figmaImport';

const KIND_LABEL: Record<string, string> = {
  'override-target-missing': 'override 대상 없음',
  'override-target-hidden': 'override 대상이 숨겨짐',
  'shape-approximated': '도형 근사',
  'paint-unsupported': '지원하지 않는 채우기',
  'paint-approximated': '근사한 채우기',
  'stroke-unsupported': '지원하지 않는 선',
  'effect-unsupported': '지원하지 않는 효과',
  'image-missing': '이미지 없음',
  'image-crop': '이미지 자르기 무시',
  'text-approximated': '텍스트 근사',
  'instance-unresolved': '펼치지 못한 인스턴스'
};

/** 가져오기 보고서. 종류별로 묶어 노드 id와 원인을 보여주고, 전체를 JSON으로 내려받게 한다. */
export function ImportReportModal({ report, onClose, onDownload }: { report: ImportReport; onClose: () => void; onDownload: () => void }): JSX.Element {
  const groups = new Map<string, ImportReport['issues']>();
  for (const item of report.issues) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <section className="import-modal report-modal" onPointerDown={(event) => event.stopPropagation()}>
        <header><strong>가져오기 보고서</strong><button aria-label="닫기" onClick={onClose}>×</button></header>
        <div className="report-body">
          <p>{report.imported}개 요소 · 인스턴스 {report.expandedInstances}개 펼침 · override {report.appliedOverrides}개 적용, {report.unappliedOverrides}개 미적용 · 도형 {report.approximatedShapes}개 근사 · 보고 항목 {report.issues.length}개</p>
          <p>메인 컴포넌트 {report.components}개(Components 페이지) · 연결한 인스턴스 {report.linkedInstances}개 · 스타일에서 만든 색 토큰 {report.tokens}개</p>
          {[...groups].map(([kind, items]) => (
            <div className="report-group" key={kind}>
              <h3>{KIND_LABEL[kind] ?? kind} ({items.length})</h3>
              <ul>{items.slice(0, 50).map((item, index) => <li key={index}><code>{item.nodeId}</code> {item.name}: {item.detail}</li>)}</ul>
              {items.length > 50 ? <p>외 {items.length - 50}개는 JSON 보고서에 있습니다.</p> : null}
            </div>
          ))}
        </div>
        <footer><button onClick={onDownload}>JSON 보고서 저장</button><button className="primary" onClick={onClose}>닫기</button></footer>
      </section>
    </div>
  );
}
