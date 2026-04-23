'use client';

import Link from 'next/link';

interface SaintGraalGateProps {
  projectId: string;
}

export default function SaintGraalGate({ projectId }: SaintGraalGateProps) {
  return (
    <div className="flex-1 flex items-start justify-center pt-16 px-6">
      <div className="max-w-lg w-full">
        {/* Banner */}
        <div className="border border-accent-gold/40 bg-accent-gold/5 rounded-lg px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-accent-gold/20 border border-accent-gold/40 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-accent-gold text-sm">!</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-primary font-semibold text-sm">
                Saint Graal document required
              </p>
              <p className="text-text-secondary text-sm mt-1.5 leading-relaxed">
                This project has no Saint Graal document uploaded. The Saint Graal doc is the core brand reference — without it, no generation can run for this project.
              </p>
              <p className="text-text-muted text-xs mt-2.5 leading-relaxed">
                Upload your Saint Graal PDF or document in the project files, then come back here to generate.
              </p>
              <div className="mt-4">
                <Link
                  href={`/projects/${projectId}`}
                  className="btn-primary inline-flex items-center gap-2 text-xs"
                >
                  Go to Project Files →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* What to upload */}
        <div className="card mt-4 px-5 py-4">
          <p className="text-text-muted text-xs uppercase tracking-widest mb-3">What to upload</p>
          <div className="space-y-2">
            {[
              { label: 'Saint Graal doc', required: true, desc: 'Core brand brief — required to unlock generation' },
              { label: 'Avatar doc', required: false, desc: 'Customer avatar / target persona' },
              { label: 'Winning ads', required: false, desc: 'Screenshots of your best performing ads' },
              { label: 'Validated scripts', required: false, desc: 'Scripts that have already converted' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <span className={`text-xs mt-0.5 ${item.required ? 'text-accent-gold' : 'text-text-muted'}`}>
                  {item.required ? '★' : '○'}
                </span>
                <div className="min-w-0">
                  <span className={`text-xs font-medium ${item.required ? 'text-text-primary' : 'text-text-secondary'}`}>
                    {item.label}
                    {item.required && <span className="text-accent-gold ml-1.5 text-[10px]">REQUIRED</span>}
                  </span>
                  <p className="text-text-muted text-[10px] mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
