use axum::extract::{Query, State};
use axum::Json;

use crate::dto::routing::{
    DirectionsQueryDto, DirectionsResponse, IsochroneQueryDto, IsochroneResponse, MatrixQueryDto,
    MatrixResponse,
};
use crate::error::AppError;
use crate::state::AppState;

fn parse_locs(s: &str) -> Result<Vec<(f64, f64)>, AppError> {
    s.split(';')
        .filter(|x| !x.is_empty())
        .map(|p| {
            let mut it = p.split(',');
            let lat: f64 = it
                .next()
                .ok_or_else(|| AppError::BadRequest("bad loc".into()))?
                .trim()
                .parse()
                .map_err(|_| AppError::BadRequest("bad lat".into()))?;
            let lon: f64 = it
                .next()
                .ok_or_else(|| AppError::BadRequest("bad loc".into()))?
                .trim()
                .parse()
                .map_err(|_| AppError::BadRequest("bad lon".into()))?;
            Ok((lat, lon))
        })
        .collect()
}

/// `GET /api/routing/directions` — get directions between locations.
#[utoipa::path(
    get,
    path = "/api/routing/directions",
    tag = "routing",
    params(DirectionsQueryDto),
    responses(
        (status = 200, description = "Directions", body = DirectionsResponse),
        (status = 400, description = "Bad request"),
    )
)]
pub async fn directions(
    State(st): State<AppState>,
    Query(q): Query<DirectionsQueryDto>,
) -> Result<Json<DirectionsResponse>, AppError> {
    let locs = parse_locs(&q.locations)?;
    Ok(Json(
        st.routing
            .directions(
                q.costing.as_deref().unwrap_or("auto"),
                q.language.as_deref().unwrap_or("vi"),
                &locs,
            )
            .await?,
    ))
}

/// `GET /api/routing/matrix` — compute distance/time matrix.
#[utoipa::path(
    get,
    path = "/api/routing/matrix",
    tag = "routing",
    params(MatrixQueryDto),
    responses(
        (status = 200, description = "Matrix result", body = MatrixResponse),
        (status = 400, description = "Bad request"),
    )
)]
pub async fn matrix(
    State(st): State<AppState>,
    Query(q): Query<MatrixQueryDto>,
) -> Result<Json<MatrixResponse>, AppError> {
    let srcs = parse_locs(&q.sources)?;
    let tgts = parse_locs(&q.targets)?;
    Ok(Json(
        st.routing
            .matrix(q.costing.as_deref().unwrap_or("auto"), &srcs, &tgts)
            .await?,
    ))
}

/// `GET /api/routing/isochrone` — compute isochrone contours.
#[utoipa::path(
    get,
    path = "/api/routing/isochrone",
    tag = "routing",
    params(IsochroneQueryDto),
    responses(
        (status = 200, description = "Isochrone result", body = IsochroneResponse),
        (status = 400, description = "Bad request"),
    )
)]
pub async fn isochrone(
    State(st): State<AppState>,
    Query(q): Query<IsochroneQueryDto>,
) -> Result<Json<IsochroneResponse>, AppError> {
    let contours: Vec<u32> = q
        .contours
        .as_deref()
        .map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect())
        .unwrap_or_else(|| vec![15, 30, 60]);
    Ok(Json(
        st.routing
            .isochrone(
                q.costing.as_deref().unwrap_or("auto"),
                (q.lat, q.lon),
                &contours,
            )
            .await?,
    ))
}

/// Build the routing (Valhalla proxy) router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/directions", get(directions))
        .route("/matrix", get(matrix))
        .route("/isochrone", get(isochrone))
}
