import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <div className="position-relative">
      <div className="authentication-wrapper authentication-basic container-p-y">
        <div className="authentication-inner py-6 mx-4">

          <div className="card p-sm-7 p-2">

            {/* Logo */}
            <div className="app-brand justify-content-center mt-5">
              <a href="/" className="app-brand-link gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/cow-mana.svg"
                  alt="Cow→Mana"
                  style={{ height: '56px', width: 'auto' }}
                />
              </a>
            </div>

            <div className="card-body mt-1">
              <LoginForm />
            </div>

          </div>

          {/* Decorative illustrations (desktop only) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/materio/img/tree-3.png"
            alt=""
            className="authentication-image-object-left d-none d-lg-block"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/materio/img/auth-basic-mask-light.png"
            className="authentication-image d-none d-lg-block scaleX-n1-rtl"
            height={172}
            alt=""
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/materio/img/tree.png"
            alt=""
            className="authentication-image-object-right d-none d-lg-block"
          />

        </div>
      </div>
    </div>
  );
}
