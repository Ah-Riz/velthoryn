import Image from "next/image";
import Link from "next/link";
import { SmoothScrollLink } from "@/components/landing/SmoothScrollLink";

const repoUrl = "https://github.com/Ah-Riz/mancerxsuperteam-token-vesting";
const docsBase = `${repoUrl}/tree/test/docs`;

export function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="ftop">
          <div className="fcol brand-col">
            <div className="lp-brand">
              <Image
                src="/brand/velthoryn-logo-sm.svg"
                alt=""
                aria-hidden="true"
                className="lp-brand-logo lp-brand-logo-footer"
                width={30}
                height={30}
              />
              <span className="name">Velthoryn</span>
            </div>
            <p>
              Solana-native token vesting and Merkle-compressed distribution.
              Fair, automatic, and cheap.
            </p>
            <div className="footer-cta">
              <Link href="/campaign/create" className="lp-btn waitlist-cta">
                Open app <span className="arrow">&rarr;</span>
              </Link>
              <a
                href={`${docsBase}/PROGRAM.md`}
                className="lp-btn ghost"
                target="_blank"
                rel="noopener noreferrer"
              >
                View docs
              </a>
            </div>
            <div className="social">
              <a href={repoUrl} aria-label="GitHub" target="_blank" rel="noopener noreferrer">
                <svg width="15" height="15">
                  <use href="#iGh" />
                </svg>
              </a>
            </div>
          </div>
          <div className="fcol">
            <h5>Product</h5>
            <a href="#product">Merkle Distribution</a>
            <a href="#product">Vesting Schedules</a>
            <a href="#product">Clawback</a>
            <a href="#how">How it works</a>
          </div>
          <div className="fcol">
            <h5>Resources</h5>
            <a href={`${docsBase}/PROGRAM.md`} target="_blank" rel="noopener noreferrer">Documentation</a>
            <a href={`${docsBase}/INTEGRATION.md`} target="_blank" rel="noopener noreferrer">Integration Guide</a>
            <a href={`${docsBase}/BACKEND_API.md`} target="_blank" rel="noopener noreferrer">Backend API</a>
            <a href={repoUrl} target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
          <div className="fcol">
            <h5>Trust</h5>
            <a href={`${docsBase}/SECURITY.md`} target="_blank" rel="noopener noreferrer">Security Notes</a>
            <a href={`${docsBase}/DEVNET_TEST_RESULTS.md`} target="_blank" rel="noopener noreferrer">Devnet Results</a>
            <a href={`${docsBase}/PROGRAM.md`} target="_blank" rel="noopener noreferrer">Program Internals</a>
            <a href={repoUrl} target="_blank" rel="noopener noreferrer">Open Source</a>
          </div>
          <div className="fcol">
            <h5>Get Started</h5>
            <SmoothScrollLink href="#faq">FAQ</SmoothScrollLink>
            <SmoothScrollLink href="#waitlist">Waitlist</SmoothScrollLink>
            <Link href="/campaign/create">Open app</Link>
            <a href={`${repoUrl}/issues`} target="_blank" rel="noopener noreferrer">Contact</a>
          </div>
        </div>
        <div className="fbot">
          <span>&copy; 2026 VELTHORYN LABS &middot; ALL RIGHTS RESERVED</span>
          <span className="chain">
            <i /> SOLANA &middot; PRE-LAUNCH
          </span>
        </div>
      </div>
    </footer>
  );
}
